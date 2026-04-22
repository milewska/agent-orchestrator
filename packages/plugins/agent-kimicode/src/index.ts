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
import { readdir, stat } from "node:fs/promises";
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

/** TTL for session match cache (ms) — avoids redundant scans when
 *  getActivityState / getSessionInfo / getRestoreCommand all fire in one
 *  refresh cycle. Mirrors agent-codex's SESSION_FILE_CACHE_TTL_MS. */
const SESSION_MATCH_CACHE_TTL_MS = 30_000;

/** Per-workspace cache of the resolved session directory. */
const sessionMatchCache = new Map<string, { match: KimiSessionMatch | null; expiry: number }>();

/**
 * Get the mtime of the freshest live signal inside a Kimi session directory.
 * context.jsonl / wire.jsonl update on every agent turn. Probed in parallel
 * to avoid serial filesystem roundtrips.
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
 * There is no `state.json`. We hash the workspace path to find the bucket,
 * then pick the most-recently-modified UUID subdirectory inside it.
 */
async function findKimiSessionMatchUncached(
  workspacePath: string,
): Promise<KimiSessionMatch | null> {
  const bucket = join(kimiShareDir(), "sessions", kimiWorkspaceHash(workspacePath));
  let entries: string[];
  try {
    entries = await readdir(bucket);
  } catch {
    return null;
  }

  let best: { dir: string; sessionId: string; mtime: Date; mtimeMs: number } | null = null;

  for (const entry of entries) {
    const dir = join(bucket, entry);
    const mtime = await getKimiLiveSignalMtime(dir);
    if (!mtime) continue;
    const mtimeMs = mtime.getTime();
    if (!best || mtimeMs > best.mtimeMs) {
      best = { dir, sessionId: entry, mtime, mtimeMs };
    }
  }

  return best ? { dir: best.dir, sessionId: best.sessionId, mtime: best.mtime } : null;
}

/** Cached wrapper around findKimiSessionMatchUncached. */
async function findKimiSessionMatch(workspacePath: string): Promise<KimiSessionMatch | null> {
  const cached = sessionMatchCache.get(workspacePath);
  if (cached && Date.now() < cached.expiry) {
    return cached.match;
  }
  const match = await findKimiSessionMatchUncached(workspacePath);
  sessionMatchCache.set(workspacePath, {
    match,
    expiry: Date.now() + SESSION_MATCH_CACHE_TTL_MS,
  });
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

      // Generic shell/REPL prompt — agent is idle waiting for user input.
      if (/^[>$#]\s*$/.test(lastLine)) return "idle";
      // Kimi's interactive prompt variants.
      if (/^kimi[>:]?\s*$/i.test(lastLine)) return "idle";

      const tail = lines.slice(-6).join("\n");

      // Approval / confirmation prompts. Anchored to avoid matching narration
      // like "I approve of this approach" in the middle of agent output.
      if (/\(y\)es.*\(n\)o/i.test(tail)) return "waiting_input";
      if (/\[y\/n\]\s*[?:]?\s*$/im.test(tail)) return "waiting_input";
      if (/^\s*approve\??\s*$/im.test(tail)) return "waiting_input";
      if (/\bapproval required\b/i.test(tail)) return "waiting_input";
      if (/^\s*do you want to (proceed|continue)\?\s*$/im.test(tail)) return "waiting_input";
      if (/^\s*allow .+\?\s*$/im.test(tail)) return "waiting_input";

      // Hard errors surfaced to the terminal. Line-anchored to avoid matching
      // narration like "I failed to connect earlier, so I tried X instead".
      if (/^\s*error:/im.test(tail)) return "blocked";
      if (/^\s*(?:error:\s*)?failed to (connect|authenticate|load)\b/im.test(tail)) return "blocked";

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
      const match = await findKimiSessionMatch(session.workspacePath);
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
          // Match both `kimi` and `.kimi` (some installers use a dot-prefixed
          // shim), as well as `uv run kimi` / `python -m kimi` invocations.
          const processRe = /(?:^|\/)\.?kimi(?:\s|$)|(?:\s|^)kimi(?:\s|$)/;
          for (const line of psOut.split("\n")) {
            const cols = line.trimStart().split(/\s+/);
            if (cols.length < 3 || !ttySet.has(cols[1] ?? "")) continue;
            const args = cols.slice(2).join(" ");
            if (processRe.test(args)) {
              return true;
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

      const match = await findKimiSessionMatch(session.workspacePath);
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

      const match = await findKimiSessionMatch(session.workspacePath);
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

export function detect(): boolean {
  // `kimi` is not a uniquely-claimed binary name, so verify the output looks
  // like MoonshotAI's kimi-cli rather than trusting any binary that exits 0.
  // `kimi info` prints the package name and protocol versions; `--version`
  // is a lighter-weight cross-check.
  try {
    const versionOut = execFileSync("kimi", ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    if (/\bkimi[-_ ]?(?:cli|code)?\b/i.test(versionOut)) return true;
    // Some builds of kimi-cli print just a version number — cross-check with
    // `kimi info` which includes the package identifier.
    const infoOut = execFileSync("kimi", ["info"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return /\bkimi[-_ ]?(?:cli|code)?\b/i.test(infoOut) || /moonshot/i.test(infoOut);
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
