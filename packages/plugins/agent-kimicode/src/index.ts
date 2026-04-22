import {
  DEFAULT_READY_THRESHOLD_MS,
  DEFAULT_ACTIVE_WINDOW_MS,
  shellEscape,
  normalizeAgentPermissionMode,
  buildAgentPath,
  setupPathWrapperWorkspace,
  readLastActivityEntry,
  checkActivityLogState,
  getActivityFallbackState,
  recordTerminalActivity,
  PREFERRED_GH_PATH,
  type Agent,
  type AgentSessionInfo,
  type AgentLaunchConfig,
  type AgentPermissionInput,
  type ActivityDetection,
  type ActivityState,
  type PluginModule,
  type ProjectConfig,
  type RuntimeHandle,
  type Session,
  type WorkspaceHooksConfig,
} from "@aoagents/ao-core";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readdir, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// =============================================================================
// Kimi Session Directory Helpers
// =============================================================================

/** Kimi stores sessions under ~/.kimi/ (override via KIMI_SHARE_DIR). */
function kimiShareDir(): string {
  const override = process.env["KIMI_SHARE_DIR"];
  if (override && override.trim().length > 0) return override;
  return join(homedir(), ".kimi");
}

interface KimiSessionMatch {
  /** Absolute path to the session directory, e.g.
   *  ~/.kimi/sessions/<md5(cwd)>/<session-uuid>/ */
  dir: string;
  /** Session UUID (directory basename) — accepted by `kimi --resume <id>`. */
  sessionId: string;
  /** mtime of the newest live-signal file (context.jsonl / wire.jsonl).
   *  Captured during the scan so callers don't re-stat. */
  mtime: Date;
}

/** MD5 hex digest of an absolute workspace path — kimi uses this as the
 *  per-workspace bucket under ~/.kimi/sessions/. */
function kimiWorkspaceHash(workspacePath: string): string {
  return createHash("md5").update(workspacePath).digest("hex");
}

/**
 * Resolve the workspace path kimi would see as its cwd. kimi's process reads
 * cwd via `os.getcwd()`, which on Linux returns the realpath (symlinks are
 * resolved by the kernel via /proc/self/cwd). If AO hands us a symlinked
 * workspacePath, our MD5 of the symlink won't match kimi's MD5 of the
 * resolved path — session discovery would silently miss every session.
 *
 * realpath() is best-effort: if the path doesn't exist or isn't readable,
 * fall back to the raw string so we don't regress workflows where the
 * workspace is created later or the caller has stricter sandboxing.
 */
async function resolveWorkspacePath(workspacePath: string): Promise<string> {
  try {
    return await realpath(workspacePath);
  } catch {
    return workspacePath;
  }
}

/** Positive-result TTL: a found session is unlikely to change identity within
 *  a single refresh cycle. Mirrors agent-codex's SESSION_FILE_CACHE_TTL_MS. */
const SESSION_MATCH_CACHE_TTL_MS = 30_000;
/** Negative-result TTL: kept short so a session that appears mid-poll is picked
 *  up on the next cycle instead of staying null for the full positive TTL. */
const SESSION_MATCH_NEGATIVE_TTL_MS = 2_000;
/** Soft cap on the cache map size — prunes expired entries when exceeded so
 *  long-running daemons with many worktrees don't grow unbounded. */
const SESSION_MATCH_CACHE_MAX_ENTRIES = 256;

/** Per-workspace cache of the resolved session directory. */
const sessionMatchCache = new Map<string, { match: KimiSessionMatch | null; expiry: number }>();

/**
 * Sandbox check — fail closed if a candidate path escapes ~/.kimi/sessions/.
 * Bucket entries in a real kimi install are regular directories, but a
 * symlink placed there (maliciously or accidentally) would let stat() /
 * createReadStream() follow it to arbitrary filesystem locations, potentially
 * hanging on FIFOs/sockets or leaking reads from unrelated files.
 */
async function isInsideKimiSessions(candidate: string): Promise<boolean> {
  const sessionsRoot = join(kimiShareDir(), "sessions");
  let rootReal: string;
  let candReal: string;
  try {
    rootReal = await realpath(sessionsRoot);
  } catch {
    return false;
  }
  try {
    candReal = await realpath(candidate);
  } catch {
    return false;
  }
  const rootWithSep = rootReal.endsWith("/") ? rootReal : rootReal + "/";
  return candReal === rootReal || candReal.startsWith(rootWithSep);
}

/**
 * Get the mtime of the freshest live signal inside a Kimi session directory.
 * context.jsonl / wire.jsonl update on every agent turn. Returns null when
 * neither file exists — callers must treat this dir as "not a real session".
 * Probed in parallel to avoid serial filesystem roundtrips.
 */
async function getKimiLiveSignalMtime(sessionDir: string): Promise<Date | null> {
  const stats = await Promise.all(
    ["context.jsonl", "wire.jsonl"].map((name) =>
      stat(join(sessionDir, name)).catch(() => null),
    ),
  );
  let newest: Date | null = null;
  for (const s of stats) {
    if (s && (!newest || s.mtimeMs > newest.getTime())) newest = s.mtime;
  }
  return newest;
}

/**
 * Find the Kimi session directory for this workspace.
 *
 * Layout (kimi-cli 1.38):
 *   ~/.kimi/sessions/<md5(cwd)>/<session-uuid>/
 *     context.jsonl   — conversation history
 *     wire.jsonl      — turn events
 *
 * Stability rules:
 *   1. A UUID is preferred when \`session.metadata.kimiSessionId\` pins it —
 *      that binding is captured at launch and survives kimi cwd-normalization
 *      changes, worktree moves, and manual \`kimi\` invocations in the same
 *      repo (two AO sessions sharing a bucket would otherwise step on each
 *      other's summaries / --resume targets).
 *   2. If no UUID is pinned, only UUIDs whose live files exist AND whose mtime
 *      is no older than the AO session's \`createdAt - 60s\` are considered —
 *      stray temp dirs or crash leftovers never get picked up.
 *   3. Every candidate dir is sandbox-checked to stay inside
 *      ~/.kimi/sessions/; symlinks pointing outside are rejected.
 */
async function findKimiSessionMatchUncached(
  session: Session,
): Promise<KimiSessionMatch | null> {
  if (!session.workspacePath) return null;
  const resolved = await resolveWorkspacePath(session.workspacePath);
  const bucket = join(kimiShareDir(), "sessions", kimiWorkspaceHash(resolved));

  if (!(await isInsideKimiSessions(bucket))) return null;

  let entries: string[];
  try {
    entries = await readdir(bucket);
  } catch {
    return null;
  }

  const pinnedId =
    typeof session.metadata?.["kimiSessionId"] === "string"
      ? (session.metadata["kimiSessionId"] as string)
      : null;

  // Any UUID older than (session.createdAt - grace) is from a prior life.
  const minAgeMs = session.createdAt.getTime() - 60_000;

  let best: { dir: string; sessionId: string; mtime: Date; mtimeMs: number } | null = null;

  for (const entry of entries) {
    const dir = join(bucket, entry);
    if (!(await isInsideKimiSessions(dir))) continue;

    const liveMtime = await getKimiLiveSignalMtime(dir);
    if (!liveMtime) continue;

    if (pinnedId) {
      if (entry !== pinnedId) continue;
      return { dir, sessionId: entry, mtime: liveMtime };
    }

    if (liveMtime.getTime() < minAgeMs) continue;

    const mtimeMs = liveMtime.getTime();
    if (!best || mtimeMs > best.mtimeMs) {
      best = { dir, sessionId: entry, mtime: liveMtime, mtimeMs };
    }
  }

  if (pinnedId && !best) {
    // Pinned UUID didn't match anything — don't silently fall back to a
    // "closest guess"; that reintroduces the wrong-session bug.
    return null;
  }

  return best ? { dir: best.dir, sessionId: best.sessionId, mtime: best.mtime } : null;
}

/** Prune expired entries; if still over the cap, drop the oldest. */
function pruneSessionMatchCache(now: number): void {
  for (const [key, entry] of sessionMatchCache) {
    if (entry.expiry <= now) sessionMatchCache.delete(key);
  }
  if (sessionMatchCache.size <= SESSION_MATCH_CACHE_MAX_ENTRIES) return;
  const sorted = [...sessionMatchCache.entries()].sort((a, b) => a[1].expiry - b[1].expiry);
  const toDrop = sessionMatchCache.size - SESSION_MATCH_CACHE_MAX_ENTRIES;
  for (let i = 0; i < toDrop; i++) {
    const entry = sorted[i];
    if (entry) sessionMatchCache.delete(entry[0]);
  }
}

/** Cached wrapper around findKimiSessionMatchUncached. */
async function findKimiSessionMatch(session: Session): Promise<KimiSessionMatch | null> {
  const workspacePath = session.workspacePath;
  if (!workspacePath) return null;

  // Key on (workspace, pinnedUuid) so two AO sessions in the same bucket
  // don't poison each other's cache entries via the pinned-id lookup.
  const pinnedId =
    typeof session.metadata?.["kimiSessionId"] === "string"
      ? (session.metadata["kimiSessionId"] as string)
      : "";
  const key = `${workspacePath} ${pinnedId}`;

  const now = Date.now();
  const cached = sessionMatchCache.get(key);
  if (cached && cached.expiry > now) return cached.match;
  if (cached) sessionMatchCache.delete(key);

  const match = await findKimiSessionMatchUncached(session);
  const ttl = match ? SESSION_MATCH_CACHE_TTL_MS : SESSION_MATCH_NEGATIVE_TTL_MS;
  sessionMatchCache.set(key, { match, expiry: now + ttl });
  if (sessionMatchCache.size > SESSION_MATCH_CACHE_MAX_ENTRIES) {
    pruneSessionMatchCache(now);
  }
  return match;
}

/** Max chars we keep from a wire.jsonl user-input summary. */
const SUMMARY_MAX_CHARS = 120;
/** Max bytes of wire.jsonl we read looking for the first TurnBegin. */
const SUMMARY_SCAN_BYTE_LIMIT = 1_000_000;

/**
 * Extract the first user prompt from a session's wire.jsonl as a fallback
 * summary. Stops after the first TurnBegin or after reading ~1 MB (whichever
 * comes first) so we never slurp huge session logs.
 */
async function extractKimiSummary(sessionDir: string): Promise<string | null> {
  const wirePath = join(sessionDir, "wire.jsonl");
  let summary: string | null = null;
  try {
    const rl = createInterface({
      input: createReadStream(wirePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    let bytes = 0;
    for await (const line of rl) {
      bytes += line.length;
      if (bytes > SUMMARY_SCAN_BYTE_LIMIT) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const entry = parsed as Record<string, unknown>;
        const message = entry["message"];
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        const msg = message as Record<string, unknown>;
        if (msg["type"] !== "TurnBegin") continue;
        const payload = msg["payload"];
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
        const userInput = (payload as Record<string, unknown>)["user_input"];
        if (typeof userInput === "string" && userInput.length > 0) {
          summary =
            userInput.length > SUMMARY_MAX_CHARS
              ? userInput.slice(0, SUMMARY_MAX_CHARS) + "..."
              : userInput;
          break;
        }
      } catch {
        // Skip malformed line
      }
    }
    rl.close();
  } catch {
    return null;
  }
  return summary;
}

// =============================================================================
// Plugin Manifest
// =============================================================================

export const manifest = {
  name: "kimicode",
  slot: "agent" as const,
  description: "Agent plugin: Kimi Code CLI (MoonshotAI)",
  version: "0.1.0",
  displayName: "Kimi Code",
};

// =============================================================================
// Agent Implementation
// =============================================================================

/**
 * Append approval flags — kimi uses `--yolo` (aka `-y`, `--yes`, `--auto-approve`).
 * Suggest/ask modes have no dedicated flag; kimi prompts inline by default.
 */
function appendApprovalFlags(
  parts: string[],
  permissions: AgentPermissionInput | undefined,
): void {
  const mode = normalizeAgentPermissionMode(permissions);
  if (mode === "permissionless" || mode === "auto-edit") {
    parts.push("--yolo");
  }
}

function createKimicodeAgent(): Agent {
  return {
    name: "kimicode",
    processName: "kimi",

    getLaunchCommand(config: AgentLaunchConfig): string {
      const parts: string[] = ["kimi"];

      // NOTE: We'd like to pass --work-dir <session.workspacePath> to kill the
      // silent failure mode where shell-rc / tmux-hook cwd drift makes our
      // md5(cwd) hash diverge from kimi's. But AgentLaunchConfig only exposes
      // projectConfig.path (the project root), not the per-session worktree,
      // and passing the project root would actively break discovery. The
      // runtime's cwd handling is load-bearing here; see README follow-up
      // about exposing session.workspacePath on AgentLaunchConfig.

      appendApprovalFlags(parts, config.permissions);

      if (config.model) {
        parts.push("--model", shellEscape(config.model));
      }

      // Route AO-level subagent selection to kimi's `--agent NAME`
      // (built-in agents: default, okabe, or custom via --agent-file).
      if (config.subagent) {
        parts.push("--agent", shellEscape(config.subagent));
      }

      // Kimi does not have a documented system-prompt flag for ad-hoc injection;
      // --agent-file is the closest, but requires a dedicated file on disk.
      // Prefer passing systemPromptFile directly when the caller asked for a
      // file-backed system prompt.
      if (config.systemPromptFile) {
        parts.push("--agent-file", shellEscape(config.systemPromptFile));
      }

      // kimi's `-p`/`--prompt` is just the prompt string (alias of `--command`).
      // It does NOT switch to print/exit mode — that's the separate `--print`
      // flag, which we never set. Inline delivery is reliable and avoids the
      // post-launch sendMessage() delay.
      if (config.prompt) {
        parts.push("--prompt", shellEscape(config.prompt));
      }

      return parts.join(" ");
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {};
      env["AO_SESSION_ID"] = config.sessionId;
      if (config.issueId) {
        env["AO_ISSUE_ID"] = config.issueId;
      }

      // Prepend ~/.ao/bin so gh/git wrappers intercept PR/commit commands.
      env["PATH"] = buildAgentPath(process.env["PATH"]);
      env["GH_PATH"] = PREFERRED_GH_PATH;

      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      if (!terminalOutput.trim()) return "idle";

      const lines = terminalOutput.trim().split("\n");
      const lastLine = lines[lines.length - 1]?.trim() ?? "";
      const tail = lines.slice(-6).join("\n");

      // Order matters: waiting_input → blocked → idle → active. Actionable
      // states must be checked BEFORE the idle-prompt check, otherwise a
      // confirmation prompt that re-renders `kimi>` on the last line would
      // get classified as idle and the session would sit forever looking
      // quiet. Matches agent-codex / agent-aider ordering.

      // 1. waiting_input — approval / confirmation prompts. Line-anchored
      //    where practical to avoid matching narration like "I approve of
      //    this approach".
      if (/\(y\)es.*\(n\)o/i.test(tail)) return "waiting_input";
      if (/\[y\/n\]\s*[?:]?\s*$/im.test(tail)) return "waiting_input";
      if (/^\s*approve\??\s*$/im.test(tail)) return "waiting_input";
      if (/\bapproval required\b/i.test(tail)) return "waiting_input";
      if (/^\s*do you want to (proceed|continue)\?\s*$/im.test(tail)) return "waiting_input";
      if (/^\s*allow .+\?\s*$/im.test(tail)) return "waiting_input";

      // 2. blocked — hard errors surfaced to the terminal. Line-anchored to
      //    skip narration ("Earlier I failed to connect, then retried").
      if (/^\s*error:/im.test(tail)) return "blocked";
      if (/^\s*(?:error:\s*)?failed to (connect|authenticate|load)\b/im.test(tail)) return "blocked";

      // 3. idle — only when nothing actionable is visible and the tail is a
      //    bare prompt. Generic shell/REPL prompt…
      if (/^[>$#]\s*$/.test(lastLine)) return "idle";
      // …or kimi's interactive prompt.
      if (/^kimi[>:]?\s*$/i.test(lastLine)) return "idle";

      // 4. active — anything else with content is ongoing work.
      return "active";
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);

      // 1. Process check — always first.
      const exitedAt = new Date();
      if (!session.runtimeHandle) return { state: "exited", timestamp: exitedAt };
      const running = await this.isProcessRunning(session.runtimeHandle);
      if (!running) return { state: "exited", timestamp: exitedAt };

      if (!session.workspacePath) return null;

      // 2. Actionable states (waiting_input / blocked) sourced from the AO
      //    activity JSONL written by recordActivity. Kimi's native JSONL format
      //    is not publicly documented, so terminal-derived state is our only
      //    reliable source for approval/error detection.
      const activityResult = await readLastActivityEntry(session.workspacePath);
      const activityState = checkActivityLogState(activityResult);
      if (activityState) return activityState;

      // 3. Native signal — mtime of the freshest live file (context.jsonl /
      //    wire.jsonl) inside ~/.kimi/sessions/<md5(cwd)>/<uuid>/. The match
      //    already captured the mtime during the scan, so no re-stat here.
      const match = await findKimiSessionMatch(session);
      if (match) {
        const ageMs = Math.max(0, Date.now() - match.mtime.getTime());
        if (ageMs <= activeWindowMs) return { state: "active", timestamp: match.mtime };
        if (ageMs <= threshold) return { state: "ready", timestamp: match.mtime };
        return { state: "idle", timestamp: match.mtime };
      }

      // 4. JSONL entry fallback (MANDATORY) — uses the last AO activity entry
      //    with age-based decay when the native signal is unavailable.
      const fallback = getActivityFallbackState(activityResult, activeWindowMs, threshold);
      if (fallback) return fallback;

      // 5. No data available.
      return null;
    },

    async recordActivity(session: Session, terminalOutput: string): Promise<void> {
      if (!session.workspacePath) return;
      await recordTerminalActivity(session.workspacePath, terminalOutput, (output) =>
        this.detectActivity(output),
      );
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
      try {
        if (handle.runtimeName === "tmux" && handle.id) {
          const { stdout: ttyOut } = await execFileAsync(
            "tmux",
            ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"],
            { timeout: 30_000 },
          );
          const ttys = ttyOut
            .trim()
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          if (ttys.length === 0) return false;

          const { stdout: psOut } = await execFileAsync("ps", ["-eo", "pid,tty,args"], {
            timeout: 30_000,
          });
          const ttySet = new Set(ttys.map((t) => t.replace(/^\/dev\//, "")));
          // Only consider argv[0] — this is the executable being run, not
          // arbitrary filenames (e.g. `cat kimi.log`) that happen to contain
          // "kimi". We accept:
          //   - argv[0] basename == "kimi" or ".kimi" (dot-prefixed shim)
          //   - argv[0] is a python/uv invocation followed by "kimi" as the
          //     next token (e.g. `uv run kimi ...`, `python -m kimi ...`).
          const argv0Re = /(?:^|\/)\.?kimi$/;
          const viaRunnerRe = /(?:^|\/)(?:uv|python3?|node)$/;
          for (const line of psOut.split("\n")) {
            const cols = line.trimStart().split(/\s+/);
            if (cols.length < 3 || !ttySet.has(cols[1] ?? "")) continue;
            const argv = cols.slice(2);
            const head = argv[0] ?? "";
            if (argv0Re.test(head)) return true;
            if (!viaRunnerRe.test(head)) continue;
            // Skip runner-internal flags (`uv run`, `python -m`) and check the
            // next positional argument.
            for (let i = 1; i < argv.length; i++) {
              const tok = argv[i];
              if (!tok || tok.startsWith("-")) continue;
              if (tok === "run" || tok === "tool" || tok === "-m") continue;
              if (argv0Re.test(tok)) return true;
              break;
            }
          }
          return false;
        }

        const rawPid = handle.data["pid"];
        const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            return true;
          } catch (err: unknown) {
            if (err instanceof Error && "code" in err && err.code === "EPERM") {
              return true;
            }
            return false;
          }
        }

        return false;
      } catch {
        return false;
      }
    },

    async getSessionInfo(session: Session): Promise<AgentSessionInfo | null> {
      if (!session.workspacePath) return null;

      const match = await findKimiSessionMatch(session);
      if (!match) return null;

      // Best-effort summary: first user input from wire.jsonl. Kimi does not
      // store a title, model, or cost breakdown on disk.
      const summary = await extractKimiSummary(match.dir);

      return {
        summary,
        summaryIsFallback: true,
        agentSessionId: match.sessionId,
      };
    },

    async getRestoreCommand(session: Session, project: ProjectConfig): Promise<string | null> {
      if (!session.workspacePath) return null;

      const match = await findKimiSessionMatch(session);
      if (!match) return null;

      const configuredModel =
        typeof project.agentConfig?.model === "string" ? project.agentConfig.model : undefined;

      const parts: string[] = ["kimi", "--resume", shellEscape(match.sessionId)];
      appendApprovalFlags(parts, project.agentConfig?.permissions);
      if (configuredModel) {
        parts.push("--model", shellEscape(configuredModel));
      }
      return parts.join(" ");
    },

    async setupWorkspaceHooks(workspacePath: string, _config: WorkspaceHooksConfig): Promise<void> {
      await setupPathWrapperWorkspace(workspacePath);
    },

    async postLaunchSetup(session: Session): Promise<void> {
      if (!session.workspacePath) return;
      await setupPathWrapperWorkspace(session.workspacePath);
    },
  };
}

// =============================================================================
// Plugin Export
// =============================================================================

export function create(): Agent {
  return createKimicodeAgent();
}

/** @internal Clear the session match cache. Exported for testing only. */
export function _resetSessionMatchCache(): void {
  sessionMatchCache.clear();
}

/** Vendor strings that positively identify MoonshotAI's kimi-cli. Plain "kimi"
 *  alone is not enough — it matches unrelated binaries (e.g. a keyboard input
 *  manager). `kimi info` on real kimi-cli prints "kimi-cli version: ..." which
 *  is a distinct identifier. */
const KIMI_VENDOR_RE = /kimi[-_](?:cli|code)|moonshot/i;
/** Keep `kimi info` output capture bounded. Real kimi-cli prints ~80 bytes,
 *  but a future release adding plugin lists / telemetry banners could push
 *  this higher. 64 KB is well above anything realistic while still guarding
 *  against a hostile binary flooding stdout. */
const DETECT_BUFFER_BYTES = 65_536;

export function detect(): boolean {
  try {
    // Use `kimi info` as the authoritative check — `kimi --version` prints
    // just "kimi, version X.Y.Z" which is too generic to distinguish the
    // MoonshotAI tool from any other binary named "kimi".
    const infoOut = execFileSync("kimi", ["info"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: DETECT_BUFFER_BYTES,
    });
    return KIMI_VENDOR_RE.test(infoOut);
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
