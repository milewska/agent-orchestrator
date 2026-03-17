import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session, RuntimeHandle, AgentLaunchConfig } from "@composio/ao-core";

const mockExecFileAsync = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      const result = mockExecFileAsync(...args.slice(0, -1));
      if (result && typeof result.then === "function") {
        result
          .then((r: { stdout: string; stderr: string }) => callback(null, r))
          .catch((e: Error) => callback(e));
      }
    }
  },
}));

import { create, manifest, default as defaultExport } from "./index.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-1",
    projectId: "test-project",
    status: "working",
    activity: "active",
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
}

function makeTmuxHandle(id = "test-session"): RuntimeHandle {
  return { id, runtimeName: "tmux", data: {} };
}
function makeProcessHandle(pid?: number | string): RuntimeHandle {
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
function mockTmuxWithProcess(processName: string, found = true) {
  mockExecFileAsync.mockImplementation((cmd: string) => {
    if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
    if (cmd === "ps") {
      const line = found ? `  789 ttys003  ${processName}` : "  789 ttys003  bash";
      return Promise.resolve({
        stdout: `  PID TT       ARGS\n${line}\n`,
        stderr: "",
      });
    }
    return Promise.reject(new Error("unexpected"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plugin manifest & exports", () => {
  it("has correct manifest", () => {
    expect(manifest).toEqual({
      name: "opencode",
      slot: "agent",
      description: "Agent plugin: OpenCode",
      version: "0.1.0",
    });
  });

  it("create() returns agent with correct name, processName, and promptDelivery", () => {
    const agent = create();
    expect(agent.name).toBe("opencode");
    expect(agent.processName).toBe("opencode");
    expect(agent.promptDelivery).toBe("post-launch");
  });

  it("default export is a valid PluginModule", () => {
    expect(defaultExport.manifest).toBe(manifest);
    expect(typeof defaultExport.create).toBe("function");
  });
});

describe("getLaunchCommand", () => {
  const agent = create();

  it("generates base command without inlined prompt (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).toContain("opencode session list --format json");
    expect(cmd).toContain("AO:sess-1");
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt is not inlined (delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix it" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("includes --model with shell-escaped value", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "claude-sonnet-4-5-20250929" }));
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929'");
    expect(cmd).not.toContain("--prompt");
  });

  it("combines model without inlined prompt (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ prompt: "Go", model: "claude-sonnet-4-5-20250929" }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --model 'claude-sonnet-4-5-20250929' --command true",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929'");
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt not inlined even with special characters (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "it's broken" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("omits optional flags when not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).not.toContain("--model");
    expect(cmd).not.toContain("--agent");
  });

  it("includes --agent flag when subagent is provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ subagent: "sisyphus" }));
    expect(cmd).toContain("--agent 'sisyphus'");
  });

  it("generates command with agent only (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "sisyphus", prompt: "fix bug" }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus' --command true",
    );
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --agent 'sisyphus'");
    expect(cmd).toContain("--agent 'sisyphus'");
    expect(cmd).not.toContain("--prompt");
  });

  it("generates command with agent, model, no inlined prompt (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        subagent: "sisyphus",
        model: "claude-sonnet-4-5-20250929",
        prompt: "fix the bug",
      }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus' --model 'claude-sonnet-4-5-20250929' --command true",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --agent 'sisyphus' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain("--agent 'sisyphus");
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929");
    expect(cmd).not.toContain("--prompt");
  });

  it("shell-escapes sessionId in the discovery failure message", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ sessionId: "sess-1; rm -rf /" }));

    expect(cmd).toContain(
      "echo 'failed to discover OpenCode session ID for AO:sess-1; rm -rf /' >&2",
    );
  });

  it("keeps the fallback if-block shell-valid on one line", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain('if [ -z "$SES_ID" ]; then SES_ID=$(opencode session list --format json');
    expect(cmd).not.toContain("then;");
  });

  it("works with different agent names: oracle (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "oracle", prompt: "review code" }),
    );
    expect(cmd).toContain("--agent 'oracle'");
    expect(cmd).not.toContain("--prompt");
  });

  it("works with different agent names: librarian (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "librarian", prompt: "find usages" }),
    );
    expect(cmd).toContain("--agent 'librarian");
    expect(cmd).not.toContain("--prompt");
  });

  it("no agent flag when subagent not provided (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "fix it" }));
    expect(cmd).not.toContain("--agent");
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("combines model without inlined prompt (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ prompt: "Go", model: "claude-sonnet-4-5-20250929" }),
    );
    expect(cmd).not.toContain("--agent");
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --model 'claude-sonnet-4-5-20250929' --command true",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929");
    expect(cmd).not.toContain("--prompt");
  });

  it("system prompt not inlined (delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an orchestrator" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("system prompt and task prompt both delivered post-launch", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an orchestrator", prompt: "do the task" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
    expect(cmd).not.toContain("do the task");
  });

  it("handles systemPrompt with special chars (delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPrompt: "it's important" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("handles very long systemPrompt (delivered post-launch)", () => {
    const longPrompt = "A".repeat(500);
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPrompt: longPrompt }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).not.toContain("--prompt");
  });

  it("systemPromptFile not inlined (delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
    expect(cmd).not.toContain("/tmp/prompt.md");
  });

  it("handles systemPromptFile with special path (delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/it's-prompt.md" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("systemPromptFile ignored in launch command (delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        systemPrompt: "direct prompt",
        systemPromptFile: "/tmp/file-prompt.md",
      }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
    expect(cmd).not.toContain("direct prompt");
    expect(cmd).not.toContain("/tmp/file-prompt.md");
  });

  it("systemPromptFile with subagent, all prompts delivered post-launch", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        systemPromptFile: "/tmp/orchestrator.md",
        subagent: "sisyphus",
        prompt: "fix the bug",
      }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus' --command true",
    );
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --agent 'sisyphus'");
    expect(cmd).toContain("--agent 'sisyphus");
    expect(cmd).not.toContain("--prompt");
    expect(cmd).not.toContain("fix the bug");
    expect(cmd).not.toContain("/tmp/orchestrator.md");
  });

  it("generates orchestrator-style launch without prompt inlining", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        sessionId: "my-orchestrator",
        permissions: "permissionless",
        systemPromptFile: "/tmp/orchestrator.md",
      }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:my-orchestrator' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("systemPromptFile with subagent, prompts delivered post-launch", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        systemPromptFile: "/tmp/orchestrator.md",
        subagent: "sisyphus",
        prompt: "fix the bug",
      }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus' --command true",
    );
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --agent 'sisyphus'");
    expect(cmd).not.toContain("--prompt");
    expect(cmd).not.toContain("fix the bug");
    expect(cmd).not.toContain("/tmp/orchestrator.md");
  });

  it("prompt with special characters not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ prompt: "fix $PATH/to/file and `rm -rf /unquoted/path`" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt with newlines not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "line1\nline2\nline3" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt with backticks not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "use `backticks` and $vars`" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt with dollar signs not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "cost is $100" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt with double quotes not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: 'say "hello" and "goodbye"' }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt with unicode not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "fix bug in café.js file" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("prompt with semicolons not inlined (post-launch delivery)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "line1; line2; line3" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).not.toContain("--prompt");
  });

  it("empty prompt still uses post-launch delivery", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1' --command true");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).toContain("opencode session list --format json");
    expect(cmd).toContain("AO:sess-1");
    expect(cmd).not.toContain("--prompt");
  });

  it("uses existing session id (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        projectConfig: {
          name: "my-project",
          repo: "owner/repo",
          path: "/workspace/repo",
          defaultBranch: "main",
          sessionPrefix: "my",
          agentConfig: { opencodeSessionId: "ses_abc123" },
        },
        prompt: "continue",
      }),
    );

    expect(cmd).toBe("opencode --session 'ses_abc123'");
  });

  it("uses existing session id with --title fallback", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
  });
});

describe("getEnvironment", () => {
  const agent = create();

  it("sets AO_SESSION_ID but not AO_PROJECT_ID (caller's responsibility)", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_SESSION_ID"]).toBe("sess-1");
    expect(env["AO_PROJECT_ID"]).toBeUndefined();
  });

  it("sets AO_ISSUE_ID when provided", () => {
    const env = agent.getEnvironment(makeLaunchConfig({ issueId: "GH-42" }));
    expect(env["AO_ISSUE_ID"]).toBe("GH-42");
  });

  it("omits AO_ISSUE_ID when not provided", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_ISSUE_ID"]).toBeUndefined();
  });
});

describe("isProcessRunning", () => {
  const agent = create();

  it("returns true when opencode found on tmux pane TTY", async () => {
    mockTmuxWithProcess("opencode");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns false when opencode not on tmux pane TTY", async () => {
    mockTmuxWithProcess("opencode", false);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns true for process handle with alive PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(123, 0);
    killSpy.mockRestore();
  });

  it("returns false for process handle with dead PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(false);
    killSpy.mockRestore();
  });

  it("returns false for unknown runtime without PID", async () => {
    const handle: RuntimeHandle = { id: "x", runtimeName: "other", data: {} };
    expect(await agent.isProcessRunning(handle)).toBe(false);
  });

  it("returns false on tmux command failure", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("tmux not running"));
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns true when PID exists but throws EPERM", async () => {
    const epermErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw epermErr;
    });
    expect(await agent.isProcessRunning(makeProcessHandle(789))).toBe(true);
    killSpy.mockRestore();
  });

  it("finds opencode on any pane in multi-pane session", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") {
        return Promise.resolve({ stdout: "/dev/ttys001\n/dev/ttys002\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  bash\n  200 ttys002  opencode run hello\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });
});

describe("detectActivity — terminal output classification", () => {
  const agent = create();

  it("returns idle for empty terminal output", () => {
    expect(agent.detectActivity("")).toBe("idle");
  });

  it("returns idle for whitespace-only terminal output", () => {
    expect(agent.detectActivity("   \n  ")).toBe("idle");
  });

  it("returns active for non-empty terminal output", () => {
    expect(agent.detectActivity("opencode is working\n")).toBe("active");
  });
});

describe("getActivityState", () => {
  const agent = create();

  function mockOpencodeSessionRows(rows: Array<Record<string, unknown>>) {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") {
        return Promise.resolve({
          stdout: JSON.stringify(rows),
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
  }

  function mockOpencodeSessionList(updated: string | number) {
    mockOpencodeSessionRows([{ id: "ses_abc123", updated }]);
  }

  it("returns idle when last activity is older than ready threshold", async () => {
    mockOpencodeSessionList(new Date(Date.now() - 120_000).toISOString());

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("idle");
  });

  it("returns ready when last activity is between active window and ready threshold", async () => {
    mockOpencodeSessionList(new Date(Date.now() - 45_000).toISOString());

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("ready");
  });

  it("returns active when last activity is recent", async () => {
    mockOpencodeSessionList(new Date(Date.now() - 10_000).toISOString());

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("active");
  });

  it("returns null when matching session has invalid updated timestamp", async () => {
    mockOpencodeSessionRows([{ id: "ses_abc123", updated: "not-a-date" }]);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state).toBeNull();
  });

  it("falls back to AO session title when opencodeSessionId metadata is missing", async () => {
    mockOpencodeSessionRows([
      {
        id: "ses_different",
        title: "AO:test-1",
        updated: new Date(Date.now() - 5_000).toISOString(),
      },
    ]);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: {},
      }),
      60_000,
    );

    expect(state?.state).toBe("active");
  });

  it("returns null when opencode session list output is malformed JSON", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") return Promise.resolve({ stdout: "not json", stderr: "" });
      return Promise.reject(new Error("unexpected"));
    });

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
    );

    expect(state).toBeNull();
  });
});

describe("getSessionInfo", () => {
  const agent = create();

  it("always returns null (not implemented)", async () => {
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
    expect(await agent.getSessionInfo(makeSession({ workspacePath: "/some/path" }))).toBeNull();
  });
});

describe("session ID capture from JSON stream", () => {
  it("validates session_id format with ses_ prefix", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("session_id");
    expect(cmd).toContain("/^ses_[A-Za-z0-9_-]+$/");
  });

  it("parses JSON lines and extracts session_id field", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("JSON.parse(trimmed)");
    expect(cmd).toContain("obj.session_id");
  });

  it("handles buffer accumulation for partial lines", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("buffer.split");
    expect(cmd).toContain("buffer = lines.pop()");
  });
});

describe("title-based fallback sorting with newest-first", () => {
  it("sorts by updated timestamp (newest first) when multiple sessions have the same title", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("opencode session list --format json");

    expect(cmd).toContain("sort((a, b) =>");
    expect(cmd).toContain("tb - ta");
  });

  it("validates session IDs with ses_ prefix pattern", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("isValidId");
    expect(cmd).toContain("/^ses_[A-Za-z0-9_-]+$/");
  });

  it("handles numeric and string timestamps in sorting", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("typeof value ===");
    expect(cmd).toContain("Number.isFinite");
    expect(cmd).toContain("Date.parse(value)");
  });
});

describe("invalid session ID rejection", () => {
  it("does not include --session for invalid opencodeSessionId in launch command", () => {
    const agent = create();

    const invalidIds = ["invalid", "SES_uppercase", "ses_", "ses spaces here", "", "ses-123"];

    for (const invalidId of invalidIds) {
      const cmd = agent.getLaunchCommand(
        makeLaunchConfig({
          projectConfig: {
            name: "my-project",
            repo: "owner/repo",
            path: "/workspace/repo",
            defaultBranch: "main",
            sessionPrefix: "my",
            agentConfig: { opencodeSessionId: invalidId },
          },
          prompt: "continue",
        }),
      );

      expect(cmd).not.toContain(`--session '${invalidId}'`);
      expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    }
  });

  it("only accepts valid ses_ prefix session IDs", () => {
    const agent = create();

    const validIds = ["ses_abc123", "ses_test-session", "ses_12345"];

    for (const validId of validIds) {
      const cmd = agent.getLaunchCommand(
        makeLaunchConfig({
          projectConfig: {
            name: "my-project",
            repo: "owner/repo",
            path: "/workspace/repo",
            defaultBranch: "main",
            sessionPrefix: "my",
            agentConfig: { opencodeSessionId: validId },
          },
          prompt: "continue",
        }),
      );

      expect(cmd).toContain(`--session '${validId}'`);
    }
  });
});
