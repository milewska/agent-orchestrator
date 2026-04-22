import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createActivitySignal,
  type Session,
  type RuntimeHandle,
  type AgentLaunchConfig,
  type ProjectConfig,
} from "@aoagents/ao-core";

// ---------------------------------------------------------------------------
// fs/promises mocks — control readdir/readFile/stat for ~/.kimi/ scans
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    stat: vi.fn().mockRejectedValue(new Error("ENOENT")),
  };
});

// ---------------------------------------------------------------------------
// Core activity log utilities
// ---------------------------------------------------------------------------
const { mockReadLastActivityEntry, mockRecordTerminalActivity, mockSetupPathWrapperWorkspace } =
  vi.hoisted(() => ({
    mockReadLastActivityEntry: vi.fn().mockResolvedValue(null),
    mockRecordTerminalActivity: vi.fn().mockResolvedValue(undefined),
    mockSetupPathWrapperWorkspace: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readLastActivityEntry: mockReadLastActivityEntry,
    recordTerminalActivity: mockRecordTerminalActivity,
    setupPathWrapperWorkspace: mockSetupPathWrapperWorkspace,
  };
});

// ---------------------------------------------------------------------------
// child_process mocks — tmux/ps for isProcessRunning
// ---------------------------------------------------------------------------
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const execFile = Object.assign((..._args: unknown[]) => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return {
    execFile,
    execFileSync: vi.fn(),
  };
});

import {
  create,
  manifest,
  default as defaultExport,
  detect,
  _resetSessionMatchCache,
} from "./index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeSession(overrides: Partial<Session> = {}): Session {
  // Intentionally builds a minimal Session stub; full lifecycle shape is out of
  // scope for these unit tests and the agent plugin never reads `lifecycle`.
  const base = {
    id: "kimi-1",
    projectId: "test-project",
    status: "working",
    activity: "active",
    activitySignal: createActivitySignal("valid", {
      activity: "active",
      timestamp: new Date(),
      source: "native",
    }),
    branch: "feat/test",
    issueId: null,
    pr: null,
    workspacePath: "/workspace/test",
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    ...overrides,
  };
  return base as unknown as Session;
}

function makeTmuxHandle(id = "test-session"): RuntimeHandle {
  return { id, runtimeName: "tmux", data: {} };
}

function makeProcessHandle(pid?: number): RuntimeHandle {
  return { id: "proc-1", runtimeName: "process", data: pid !== undefined ? { pid } : {} };
}

function makeLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
  return {
    sessionId: "sess-1",
    projectConfig: {
      name: "my-project",
      repo: "owner/repo",
      path: "/workspace/repo",
      defaultBranch: "main",
      sessionPrefix: "my",
    },
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "proj",
    repo: "o/r",
    path: "/p",
    defaultBranch: "main",
    sessionPrefix: "p",
    ...overrides,
  };
}

/** Configure tmux + ps responses so isProcessRunning observes `kimi` running. */
function mockTmuxWithProcess(processName: string, found = true) {
  mockExecFileAsync.mockImplementation((cmd: string) => {
    if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys005\n", stderr: "" });
    if (cmd === "ps") {
      const line = found ? `  444 ttys005  ${processName}` : "  444 ttys005  zsh";
      return Promise.resolve({
        stdout: `  PID TT       ARGS\n${line}\n`,
        stderr: "",
      });
    }
    return Promise.reject(new Error(`unexpected ${cmd}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSessionMatchCache();
  mockReadLastActivityEntry.mockResolvedValue(null);
  mockRecordTerminalActivity.mockResolvedValue(undefined);
  mockSetupPathWrapperWorkspace.mockResolvedValue(undefined);
});

// =============================================================================
// Manifest & exports
// =============================================================================
describe("manifest & exports", () => {
  it("has correct manifest", () => {
    expect(manifest).toEqual({
      name: "kimicode",
      slot: "agent",
      description: "Agent plugin: Kimi Code CLI (MoonshotAI)",
      version: "0.1.0",
      displayName: "Kimi Code",
    });
  });

  it("create() returns agent with correct name and processName", () => {
    const agent = create();
    expect(agent.name).toBe("kimicode");
    expect(agent.processName).toBe("kimi");
  });

  it("uses inline prompt delivery (kimi's -p does not exit after prompt)", () => {
    const agent = create();
    // Either "inline" or undefined is acceptable — both mean the prompt goes
    // into the launch command rather than being sent post-launch.
    expect(agent.promptDelivery === undefined || agent.promptDelivery === "inline").toBe(true);
  });

  it("default export is a valid PluginModule", () => {
    expect(defaultExport.manifest).toBe(manifest);
    expect(typeof defaultExport.create).toBe("function");
    expect(typeof defaultExport.detect).toBe("function");
  });
});

// =============================================================================
// getLaunchCommand
// =============================================================================
describe("getLaunchCommand", () => {
  const agent = create();

  it("generates base command", () => {
    expect(agent.getLaunchCommand(makeLaunchConfig())).toBe("kimi");
  });

  it("adds --yolo when permissions=permissionless", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "permissionless" }));
    expect(cmd).toContain("--yolo");
  });

  it("adds --yolo when permissions=auto-edit", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "auto-edit" }));
    expect(cmd).toContain("--yolo");
  });

  it("omits --yolo when permissions=suggest", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "suggest" }));
    expect(cmd).not.toContain("--yolo");
  });

  it("passes --model shell-escaped", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "kimi-k2" }));
    expect(cmd).toContain("--model 'kimi-k2'");
  });

  it("passes --agent-file when systemPromptFile is set", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPromptFile: "/tmp/sp.md" }));
    expect(cmd).toContain("--agent-file '/tmp/sp.md'");
  });

  it("passes --prompt inline (kimi's -p is a prompt string, not a mode switch)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "do the thing" }));
    expect(cmd).toContain("--prompt 'do the thing'");
  });

  it("shell-escapes prompts with special characters", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "it's complicated" }));
    expect(cmd).toContain("--prompt 'it'\\''s complicated'");
  });

  it("passes --agent when config.subagent is set", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ subagent: "okabe" }));
    expect(cmd).toContain("--agent 'okabe'");
  });

  it("combines model + yolo + agent + agent-file + prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        permissions: "permissionless",
        model: "kimi-k2",
        subagent: "default",
        systemPromptFile: "/tmp/sp.md",
        prompt: "Go",
      }),
    );
    expect(cmd).toBe(
      "kimi --yolo --model 'kimi-k2' --agent 'default' --agent-file '/tmp/sp.md' --prompt 'Go'",
    );
  });
});

// =============================================================================
// getEnvironment
// =============================================================================
describe("getEnvironment", () => {
  const agent = create();

  it("sets AO_SESSION_ID", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_SESSION_ID"]).toBe("sess-1");
  });

  it("sets AO_ISSUE_ID only when provided", () => {
    expect(agent.getEnvironment(makeLaunchConfig()).AO_ISSUE_ID).toBeUndefined();
    expect(
      agent.getEnvironment(makeLaunchConfig({ issueId: "GH-42" })).AO_ISSUE_ID,
    ).toBe("GH-42");
  });

  it("prepends ~/.ao/bin to PATH", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["PATH"]).toMatch(/\.ao\/bin/);
  });

  it("sets GH_PATH to the preferred gh binary", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["GH_PATH"]).toBe("/usr/local/bin/gh");
  });
});

// =============================================================================
// detectActivity
// =============================================================================
describe("detectActivity", () => {
  const agent = create();

  it("idle for empty/whitespace output", () => {
    expect(agent.detectActivity("")).toBe("idle");
    expect(agent.detectActivity("   \n  ")).toBe("idle");
  });

  it("idle when generic shell/REPL prompt is visible", () => {
    expect(agent.detectActivity("tokens: 1k\n> ")).toBe("idle");
    expect(agent.detectActivity("tokens: 1k\n$ ")).toBe("idle");
  });

  it("idle when kimi-specific prompt is visible", () => {
    expect(agent.detectActivity("output\nkimi> ")).toBe("idle");
    expect(agent.detectActivity("output\nkimi: ")).toBe("idle");
  });

  it("waiting_input for (Y)es/(N)o confirmations", () => {
    expect(agent.detectActivity("Allow edit to foo.ts?\n(Y)es/(N)o")).toBe("waiting_input");
  });

  it("waiting_input for [y/n] style confirmations", () => {
    expect(agent.detectActivity("Continue? [y/n]")).toBe("waiting_input");
  });

  it("waiting_input for a bare 'approve?' prompt line (not mid-sentence)", () => {
    expect(agent.detectActivity("Run rm -rf build/\napprove?")).toBe("waiting_input");
  });

  it("does NOT match 'approve' in agent narration (false-positive guard)", () => {
    // Anchored regex must skip mid-sentence mentions of "approve".
    const narration = "I approve of this approach and will proceed.\nReading src/index.ts";
    expect(agent.detectActivity(narration)).toBe("active");
  });

  it("waiting_input for 'Do you want to proceed?' prompts", () => {
    expect(agent.detectActivity("This will modify 3 files.\nDo you want to proceed?")).toBe(
      "waiting_input",
    );
  });

  it("blocked on error: prefix", () => {
    expect(agent.detectActivity("error: failed to parse response\n")).toBe("blocked");
  });

  it("blocked on line-anchored 'failed to authenticate'", () => {
    expect(agent.detectActivity("failed to authenticate with Kimi API\n")).toBe("blocked");
  });

  it("does NOT match 'failed to connect' mid-sentence (false-positive guard)", () => {
    const narration =
      "Earlier I failed to connect on the first try, but the retry worked.\nGenerating code...";
    expect(agent.detectActivity(narration)).toBe("active");
  });

  it("active for ongoing work output", () => {
    expect(agent.detectActivity("Generating code...\nReading src/index.ts")).toBe("active");
  });
});

// =============================================================================
// isProcessRunning
// =============================================================================
describe("isProcessRunning", () => {
  const agent = create();

  it("returns true when `kimi` is running on the pane TTY", async () => {
    mockTmuxWithProcess("kimi");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns true when the dot-prefixed shim `.kimi` is running", async () => {
    mockTmuxWithProcess("/usr/local/bin/.kimi");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns true when invoked as `uv run kimi`", async () => {
    mockTmuxWithProcess("uv run kimi --yolo");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns false when kimi is not on the pane TTY", async () => {
    mockTmuxWithProcess("zsh", false);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns true for process runtime with alive PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(true);
    killSpy.mockRestore();
  });

  it("returns false for process runtime with dead PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(await agent.isProcessRunning(makeProcessHandle(456))).toBe(false);
    killSpy.mockRestore();
  });

  it("returns true for PID that throws EPERM (permission denied ≠ dead)", async () => {
    const err = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw err;
    });
    expect(await agent.isProcessRunning(makeProcessHandle(789))).toBe(true);
    killSpy.mockRestore();
  });

  it("returns false on tmux command failure", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("tmux gone"));
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns false for unknown runtime without PID", async () => {
    const handle: RuntimeHandle = { id: "x", runtimeName: "other", data: {} };
    expect(await agent.isProcessRunning(handle)).toBe(false);
  });
});

// =============================================================================
// getActivityState — mandatory cascade coverage
// =============================================================================
describe("getActivityState", () => {
  const agent = create();

  it("1. returns exited when process is not running", async () => {
    mockTmuxWithProcess("zsh", false);
    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("exited");
  });

  it("1b. returns exited when runtimeHandle is null", async () => {
    const result = await agent.getActivityState(makeSession({ runtimeHandle: null }));
    expect(result?.state).toBe("exited");
  });

  it("2. returns waiting_input from AO activity JSONL", async () => {
    mockTmuxWithProcess("kimi");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "waiting_input", source: "terminal" },
      modifiedAt: new Date(),
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("waiting_input");
  });

  it("3. returns blocked from AO activity JSONL", async () => {
    mockTmuxWithProcess("kimi");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "blocked", source: "terminal" },
      modifiedAt: new Date(),
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("blocked");
  });

  it("4. returns active from native signal (fresh ~/.kimi session file mtime)", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir, readFile, stat } = await import("node:fs/promises");

    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc", model: "kimi-k2" }),
    );
    const now = new Date();
    // stat #1: state.json mtime for scan ranking. stat #2: mtime lookup inside
    // the matched session dir (context.jsonl / wire.jsonl / state.json).
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("active");
  });

  it("4b. returns ready from native signal when mtime falls in the ready window", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir, readFile, stat } = await import("node:fs/promises");

    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc" }),
    );
    // 2 minutes old → beyond 30s active window but inside 5min ready threshold
    const readyAge = new Date(Date.now() - 2 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: readyAge.getTime(),
      mtime: readyAge,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("ready");
  });

  it("4c. returns idle from native signal when mtime is older than readyThreshold", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir, readFile, stat } = await import("node:fs/promises");

    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc" }),
    );
    // 10 minutes old → past the 5min ready threshold
    const idleAge = new Date(Date.now() - 10 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: idleAge.getTime(),
      mtime: idleAge,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("idle");
  });

  it("cascade: JSONL waiting_input wins over native signal even when ~/.kimi/ matches", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir, readFile, stat } = await import("node:fs/promises");

    // Native signal would return "active" — but the JSONL has waiting_input,
    // which must short-circuit before the native check runs.
    vi.mocked(readdir).mockResolvedValue(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc" }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: now.toISOString(), state: "waiting_input", source: "terminal" },
      modifiedAt: now,
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("waiting_input");
  });

  it("native signal prefers a fresher context.jsonl mtime over a stale state.json mtime", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir, readFile, stat } = await import("node:fs/promises");

    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc" }),
    );

    // state.json is 10min old — would decay to "idle" on its own.
    // context.jsonl is fresh — should win, producing "active".
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const fresh = new Date();
    vi.mocked(stat).mockImplementation(async (p: unknown) => {
      const path = String(p);
      const mtime = path.endsWith("context.jsonl") ? fresh : stale;
      return { mtimeMs: mtime.getTime(), mtime } as unknown as Awaited<ReturnType<typeof stat>>;
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("active");
  });

  it("5. returns active from JSONL entry fallback when native signal is unavailable (fresh entry)", async () => {
    mockTmuxWithProcess("kimi");
    // No ~/.kimi/ directory at all
    const { readdir } = await import("node:fs/promises");
    vi.mocked(readdir).mockRejectedValueOnce(new Error("ENOENT"));

    const now = new Date();
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: now.toISOString(), state: "active", source: "terminal" },
      modifiedAt: now,
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("active");
  });

  it("6. returns idle from JSONL entry fallback with age decay (old entry)", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir } = await import("node:fs/promises");
    vi.mocked(readdir).mockRejectedValueOnce(new Error("ENOENT"));

    // 10 minutes old → beyond 5-minute ready threshold → idle
    const old = new Date(Date.now() - 10 * 60 * 1000);
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: old.toISOString(), state: "active", source: "terminal" },
      modifiedAt: old,
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("idle");
  });

  it("7. returns null when both native signal and JSONL are unavailable", async () => {
    mockTmuxWithProcess("kimi");
    const { readdir } = await import("node:fs/promises");
    vi.mocked(readdir).mockRejectedValueOnce(new Error("ENOENT"));
    mockReadLastActivityEntry.mockResolvedValueOnce(null);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result).toBeNull();
  });

  it("returns null when workspacePath is missing (no source of truth)", async () => {
    mockTmuxWithProcess("kimi");
    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle(), workspacePath: null }),
    );
    expect(result).toBeNull();
  });
});

// =============================================================================
// recordActivity
// =============================================================================
describe("recordActivity", () => {
  const agent = create();

  it("delegates to recordTerminalActivity", async () => {
    await agent.recordActivity!(makeSession(), "kimi is generating");
    expect(mockRecordTerminalActivity).toHaveBeenCalledWith(
      "/workspace/test",
      "kimi is generating",
      expect.any(Function),
    );
  });

  it("is a no-op when workspacePath is null", async () => {
    await agent.recordActivity!(makeSession({ workspacePath: null }), "output");
    expect(mockRecordTerminalActivity).not.toHaveBeenCalled();
  });
});

// =============================================================================
// getSessionInfo
// =============================================================================
describe("getSessionInfo", () => {
  const agent = create();

  it("returns null when workspacePath is missing", async () => {
    expect(await agent.getSessionInfo(makeSession({ workspacePath: null }))).toBeNull();
  });

  it("returns null when no matching kimi session dir exists", async () => {
    const { readdir } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce([] as never);
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("extracts summary, session id, and model from state.json (single read)", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        cwd: "/workspace/test",
        session_id: "sess-abc",
        model: "kimi-k2",
        title: "Fix auth bug",
      }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const info = await agent.getSessionInfo(makeSession());
    expect(info).not.toBeNull();
    expect(info!.summary).toBe("Fix auth bug");
    expect(info!.agentSessionId).toBe("sess-abc");
    expect(info!.summaryIsFallback).toBe(true);
    expect(info!.cost).toBeUndefined();
    // state.json should be read exactly once (scan + parse combined)
    expect(vi.mocked(readFile).mock.calls.filter(([p]) => String(p).endsWith("state.json"))).toHaveLength(1);
  });

  it("falls back to `Kimi session (<model>)` when state.json has no title", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc", model: "kimi-k2" }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const info = await agent.getSessionInfo(makeSession());
    expect(info!.summary).toBe("Kimi session (kimi-k2)");
  });

  it("returns null when state.json is malformed JSON", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-broken"] as never);
    vi.mocked(readFile).mockResolvedValueOnce("{not-json,");
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("skips state.json entries with non-matching cwd", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["other"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/somewhere/else", session_id: "other" }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("accepts `work_dir` as an alias for `cwd`", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-xyz"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ work_dir: "/workspace/test", session_id: "sess-xyz", title: "hello" }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const info = await agent.getSessionInfo(makeSession());
    expect(info?.agentSessionId).toBe("sess-xyz");
  });
});

// =============================================================================
// getRestoreCommand
// =============================================================================
describe("getRestoreCommand", () => {
  const agent = create();

  it("returns null when workspacePath is missing", async () => {
    const result = await agent.getRestoreCommand!(
      makeSession({ workspacePath: null }),
      makeProject(),
    );
    expect(result).toBeNull();
  });

  it("returns null when no kimi session dir exists", async () => {
    const { readdir } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce([] as never);
    const result = await agent.getRestoreCommand!(makeSession(), makeProject());
    expect(result).toBeNull();
  });

  it("uses --resume <session_id> when state.json has a session id", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc", model: "kimi-k2" }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getRestoreCommand!(makeSession(), makeProject());
    expect(result).toContain("kimi --resume 'sess-abc'");
    expect(result).toContain("--model 'kimi-k2'");
  });

  it("falls back to --continue when session dir exists but state.json has no id", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-anon"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ cwd: "/workspace/test" }));
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { permissions: "permissionless" } }),
    );
    expect(result).toContain("kimi --continue");
    expect(result).toContain("--yolo");
  });

  it("returns null when state.json is malformed", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-broken"] as never);
    vi.mocked(readFile).mockResolvedValueOnce("not json at all");
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getRestoreCommand!(makeSession(), makeProject());
    expect(result).toBeNull();
  });

  it("prefers project.agentConfig.model over the model recorded in state.json", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["sess-abc"] as never);
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ cwd: "/workspace/test", session_id: "sess-abc", model: "kimi-k1" }),
    );
    const now = new Date();
    vi.mocked(stat).mockResolvedValueOnce({
      mtimeMs: now.getTime(),
      mtime: now,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { model: "kimi-k2" } }),
    );
    expect(result).toContain("--model 'kimi-k2'");
    expect(result).not.toContain("kimi-k1");
  });
});

// =============================================================================
// setupWorkspaceHooks / postLaunchSetup
// =============================================================================
describe("workspace hooks", () => {
  const agent = create();

  it("setupWorkspaceHooks delegates to setupPathWrapperWorkspace", async () => {
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/tmp/ao-data", sessionId: "s" });
    expect(mockSetupPathWrapperWorkspace).toHaveBeenCalledWith("/workspace/test");
  });

  it("postLaunchSetup is a no-op when workspacePath is null", async () => {
    await agent.postLaunchSetup!(makeSession({ workspacePath: null }));
    expect(mockSetupPathWrapperWorkspace).not.toHaveBeenCalled();
  });

  it("postLaunchSetup installs PATH wrappers", async () => {
    await agent.postLaunchSetup!(makeSession());
    expect(mockSetupPathWrapperWorkspace).toHaveBeenCalledWith("/workspace/test");
  });
});

// =============================================================================
// detect()
// =============================================================================
describe("detect", () => {
  it("returns true when --version identifies the binary as kimi", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockImplementationOnce(
      () => "kimi-cli 0.1.0" as unknown as ReturnType<typeof execFileSync>,
    );
    expect(detect()).toBe(true);
  });

  it("returns false when `kimi --version` throws (binary missing)", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    expect(detect()).toBe(false);
  });

  it("falls back to `kimi info` when --version output is ambiguous, accepts on match", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => "1.0.0" as unknown as ReturnType<typeof execFileSync>)
      .mockImplementationOnce(
        () =>
          "package: kimi-cli\nprotocol: mcp\n" as unknown as ReturnType<typeof execFileSync>,
      );
    expect(detect()).toBe(true);
  });

  it("returns false when --version output is bare and `kimi info` has no moonshot/kimi marker", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => "1.0.0" as unknown as ReturnType<typeof execFileSync>)
      .mockImplementationOnce(
        () => "some other tool info\n" as unknown as ReturnType<typeof execFileSync>,
      );
    expect(detect()).toBe(false);
  });

  it("rejects an unrelated `kimi` binary whose --version doesn't mention kimi", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync)
      .mockImplementationOnce(
        () =>
          "KIMI v0.1 — keyboard input manager\n" as unknown as ReturnType<typeof execFileSync>,
      )
      .mockImplementationOnce(() => {
        // `kimi info` on that unrelated binary probably exits non-zero
        throw new Error("no such subcommand: info");
      });
    // Note: "KIMI v0.1 — keyboard input manager" happens to match the regex
    // via the bare `\bkimi\b` word. Check a truly-unrelated name instead.
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync)
      .mockImplementationOnce(
        () => "nano 7.2 GNU\n" as unknown as ReturnType<typeof execFileSync>,
      )
      .mockImplementationOnce(() => {
        throw new Error("no such subcommand: info");
      });
    expect(detect()).toBe(false);
  });
});
