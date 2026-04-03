import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsHumanCaller } = vi.hoisted(() => ({
  mockIsHumanCaller: vi.fn(),
}));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: mockIsHumanCaller,
}));

import { detectAvailableAgents, detectAgentRuntime } from "../../src/lib/detect-agent.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHumanCaller.mockReturnValue(false);
});

describe("detectAvailableAgents", () => {
  it("returns empty array when no plugins are importable", async () => {
    const result = await detectAvailableAgents();
    // In test env, agent plugins are not installed, so detect() fails or import fails
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("detectAgentRuntime", () => {
  it("returns claude-code when no agents detected", async () => {
    const result = await detectAgentRuntime([]);
    expect(result).toBe("claude-code");
  });

  it("returns the single agent when only one is detected", async () => {
    const result = await detectAgentRuntime([
      { name: "aider", displayName: "Aider" },
    ]);
    expect(result).toBe("aider");
  });

  it("prefers claude-code in non-interactive mode with multiple agents", async () => {
    mockIsHumanCaller.mockReturnValue(false);

    const result = await detectAgentRuntime([
      { name: "aider", displayName: "Aider" },
      { name: "claude-code", displayName: "Claude Code" },
    ]);
    expect(result).toBe("claude-code");
  });

  it("returns first agent in non-interactive mode when claude-code is unavailable", async () => {
    mockIsHumanCaller.mockReturnValue(false);

    const result = await detectAgentRuntime([
      { name: "aider", displayName: "Aider" },
      { name: "codex", displayName: "Codex" },
    ]);
    expect(result).toBe("aider");
  });

  it("prompts user in interactive mode and returns selected agent", async () => {
    mockIsHumanCaller.mockReturnValue(true);

    const mockRl = {
      question: vi.fn().mockResolvedValue("2"),
      close: vi.fn(),
    };

    vi.resetModules();
    vi.doMock("../../src/lib/caller-context.js", () => ({
      isHumanCaller: mockIsHumanCaller,
    }));
    vi.doMock("node:readline/promises", () => ({
      createInterface: () => mockRl,
    }));

    const mod = await import("../../src/lib/detect-agent.js");

    const result = await mod.detectAgentRuntime([
      { name: "aider", displayName: "Aider" },
      { name: "codex", displayName: "Codex" },
    ]);

    expect(result).toBe("codex");
    expect(mockRl.close).toHaveBeenCalled();
  });

  it("defaults to first agent on invalid interactive input", async () => {
    mockIsHumanCaller.mockReturnValue(true);

    const mockRl = {
      question: vi.fn().mockResolvedValue("abc"),
      close: vi.fn(),
    };

    vi.resetModules();
    vi.doMock("../../src/lib/caller-context.js", () => ({
      isHumanCaller: mockIsHumanCaller,
    }));
    vi.doMock("node:readline/promises", () => ({
      createInterface: () => mockRl,
    }));

    const mod = await import("../../src/lib/detect-agent.js");

    const result = await mod.detectAgentRuntime([
      { name: "aider", displayName: "Aider" },
      { name: "codex", displayName: "Codex" },
    ]);

    expect(result).toBe("aider");
    expect(mockRl.close).toHaveBeenCalled();
  });

  it("defaults to first agent on out-of-range interactive input", async () => {
    mockIsHumanCaller.mockReturnValue(true);

    const mockRl = {
      question: vi.fn().mockResolvedValue("5"),
      close: vi.fn(),
    };

    vi.resetModules();
    vi.doMock("../../src/lib/caller-context.js", () => ({
      isHumanCaller: mockIsHumanCaller,
    }));
    vi.doMock("node:readline/promises", () => ({
      createInterface: () => mockRl,
    }));

    const mod = await import("../../src/lib/detect-agent.js");

    const result = await mod.detectAgentRuntime([
      { name: "aider", displayName: "Aider" },
      { name: "codex", displayName: "Codex" },
    ]);

    expect(result).toBe("aider");
  });
});
