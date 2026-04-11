import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type * as ProcessModule from "node:process";
import { parse as yamlParse } from "yaml";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfigPathRef, mockExec, mockCheckDocker, mockCwdRef, observedDockerfileRef } = vi.hoisted(
  () => ({
    mockConfigPathRef: { current: null as string | null },
    mockExec: vi.fn(),
    mockCheckDocker: vi.fn(),
    mockCwdRef: { current: "" },
    observedDockerfileRef: { current: null as string | null },
  }),
);

vi.mock("@composio/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    loadConfigWithPath: (configPath?: string) => unknown;
  };
  return {
    ...actual,
    loadConfigWithPath: (configPath?: string) =>
      actual.loadConfigWithPath(configPath ?? mockConfigPathRef.current ?? undefined),
  };
});

vi.mock("../../src/lib/shell.js", () => ({
  exec: mockExec,
}));

vi.mock("../../src/lib/preflight.js", () => ({
  preflight: {
    checkDocker: (...args: unknown[]) => mockCheckDocker(...args),
  },
}));

vi.mock("node:process", async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessModule>();
  return {
    ...actual,
    cwd: () => mockCwdRef.current || actual.cwd(),
  };
});

import { registerDocker } from "../../src/commands/docker.js";

let tempDir: string;
let program: Command;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function writeConfig(content: string): void {
  writeFileSync(mockConfigPathRef.current!, content, "utf-8");
}

function readConfig(): Record<string, unknown> {
  return yamlParse(readFileSync(mockConfigPathRef.current!, "utf-8")) as Record<string, unknown>;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ao-docker-prepare-"));
  mockConfigPathRef.current = join(tempDir, "agent-orchestrator.yaml");
  mockCwdRef.current = tempDir;
  observedDockerfileRef.current = null;

  program = new Command();
  program.exitOverride();
  registerDocker(program);

  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  mockExec.mockReset();
  mockCheckDocker.mockReset();
  mockCheckDocker.mockResolvedValue(undefined);
  mockExec.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] === "build") {
      const buildDir = args[args.length - 1]!;
      observedDockerfileRef.current = readFileSync(join(buildDir, "Dockerfile"), "utf-8");
    }
    return { stdout: "", stderr: "" };
  });
});

afterEach(() => {
  mockConfigPathRef.current = null;
  mockCwdRef.current = "";
  observedDockerfileRef.current = null;
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("docker prepare command", () => {
  it("pulls the official image for the resolved worker agent and writes docker runtime config", async () => {
    writeConfig(`
defaults:
  runtime: tmux
  agent: codex
projects:
  app:
    repo: org/app
    path: ${tempDir}
    defaultBranch: main
`);

    await program.parseAsync(["node", "test", "docker", "prepare", "app"]);

    expect(mockCheckDocker).toHaveBeenCalledWith({
      image: "ghcr.io/composio/ao-codex:latest",
      readOnlyRoot: undefined,
      tmpfs: [],
    });
    expect(mockExec).toHaveBeenCalledWith("docker", ["pull", "ghcr.io/composio/ao-codex:latest"]);

    const raw = readConfig();
    const project = (raw["projects"] as Record<string, Record<string, unknown>>)["app"];
    expect(project["runtime"]).toBe("docker");
    expect(project["agent"]).toBe("codex");
    expect((project["worker"] as Record<string, unknown>)["agent"]).toBe("codex");
    expect((project["orchestrator"] as Record<string, unknown>)["agent"]).toBe("codex");
    expect(project["runtimeConfig"]).toEqual({
      image: "ghcr.io/composio/ao-codex:latest",
    });
  });

  it("uses project worker agent when auto-detecting the target project", async () => {
    writeConfig(`
defaults:
  runtime: tmux
  agent: codex
projects:
  app:
    repo: org/app
    path: ${tempDir}
    defaultBranch: main
    worker:
      agent: opencode
`);

    await program.parseAsync(["node", "test", "docker", "prepare"]);

    expect(mockExec).toHaveBeenCalledWith("docker", ["pull", "ghcr.io/composio/ao-opencode:latest"]);
    const output = consoleLogSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Agent:   opencode");
  });

  it("builds a local image and captures the agent-specific Dockerfile", async () => {
    writeConfig(`
defaults:
  runtime: tmux
  agent: claude-code
projects:
  app:
    repo: org/app
    path: ${tempDir}
    defaultBranch: main
`);

    await program.parseAsync([
      "node",
      "test",
      "docker",
      "prepare",
      "app",
      "--agent",
      "opencode",
      "--build-local",
      "--tag",
      "ao-real-opencode:test",
    ]);

    expect(mockExec).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["build", "-t", "ao-real-opencode:test"]),
    );
    expect(observedDockerfileRef.current).toContain("npm install -g opencode-ai");

    const raw = readConfig();
    const project = (raw["projects"] as Record<string, Record<string, unknown>>)["app"];
    expect(project["agent"]).toBe("opencode");
    expect(project["runtimeConfig"]).toEqual({
      image: "ao-real-opencode:test",
    });
  });

  it("adds /tmp tmpfs automatically when read-only root is requested", async () => {
    writeConfig(`
defaults:
  runtime: tmux
  agent: claude-code
projects:
  app:
    repo: org/app
    path: ${tempDir}
    defaultBranch: main
`);

    await program.parseAsync([
      "node",
      "test",
      "docker",
      "prepare",
      "app",
      "--read-only",
      "--memory",
      "4g",
    ]);

    expect(mockCheckDocker).toHaveBeenCalledWith({
      image: "ghcr.io/composio/ao-claude-code:latest",
      readOnlyRoot: true,
      tmpfs: ["/tmp"],
      limits: { memory: "4g" },
    });

    const raw = readConfig();
    const project = (raw["projects"] as Record<string, Record<string, unknown>>)["app"];
    expect(project["agent"]).toBe("claude-code");
    expect(project["runtimeConfig"]).toEqual({
      image: "ghcr.io/composio/ao-claude-code:latest",
      readOnlyRoot: true,
      limits: { memory: "4g" },
      tmpfs: ["/tmp"],
    });
  });

  it("supports custom images without pulling when --no-pull is set", async () => {
    writeConfig(`
defaults:
  runtime: tmux
  agent: claude-code
projects:
  app:
    repo: org/app
    path: ${tempDir}
    defaultBranch: main
`);

    await program.parseAsync([
      "node",
      "test",
      "docker",
      "prepare",
      "app",
      "--image",
      "example/custom:1.0",
      "--no-pull",
    ]);

    expect(mockExec).not.toHaveBeenCalled();
    const raw = readConfig();
    const project = (raw["projects"] as Record<string, Record<string, unknown>>)["app"];
    expect(project["agent"]).toBe("claude-code");
    expect(project["runtimeConfig"]).toEqual({
      image: "example/custom:1.0",
    });
  });

  it("suggests --build-local when pulling the official image fails", async () => {
    writeConfig(`
defaults:
  runtime: tmux
  agent: claude-code
projects:
  app:
    repo: org/app
    path: ${tempDir}
    defaultBranch: main
`);

    mockExec.mockRejectedValueOnce(new Error("manifest unknown"));

    await expect(
      program.parseAsync(["node", "test", "docker", "prepare", "app"]),
    ).rejects.toThrow("process.exit(1)");

    const errors = consoleErrorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(errors).toContain("--build-local");
  });
});
