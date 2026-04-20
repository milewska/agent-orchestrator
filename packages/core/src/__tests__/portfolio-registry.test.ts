import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveGlobalConfig, type GlobalConfig } from "../global-config.js";
import { getPortfolio } from "../portfolio-registry.js";

function makeGlobalConfig(projects: GlobalConfig["projects"] = {}): GlobalConfig {
  return {
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
    projects,
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  };
}

describe("portfolio-registry", () => {
  let tempRoot: string;
  let oldGlobalConfig: string | undefined;
  let oldConfigPath: string | undefined;
  let oldHome: string | undefined;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `ao-portfolio-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
    oldGlobalConfig = process.env["AO_GLOBAL_CONFIG"];
    oldConfigPath = process.env["AO_CONFIG_PATH"];
    oldHome = process.env["HOME"];
    process.env["HOME"] = tempRoot;
  });

  afterEach(() => {
    if (oldGlobalConfig === undefined) delete process.env["AO_GLOBAL_CONFIG"];
    else process.env["AO_GLOBAL_CONFIG"] = oldGlobalConfig;
    if (oldConfigPath === undefined) delete process.env["AO_CONFIG_PATH"];
    else process.env["AO_CONFIG_PATH"] = oldConfigPath;
    if (oldHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = oldHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("reads projects from the canonical global config path instead of AO_CONFIG_PATH discovery", () => {
    const globalConfigPath = join(tempRoot, "global-config.yaml");
    const conflictingConfigPath = join(tempRoot, "agent-orchestrator.yaml");
    const canonicalRepo = join(tempRoot, "canonical");
    const conflictingRepo = join(tempRoot, "conflicting");
    mkdirSync(canonicalRepo, { recursive: true });
    mkdirSync(conflictingRepo, { recursive: true });

    process.env["AO_GLOBAL_CONFIG"] = globalConfigPath;
    process.env["AO_CONFIG_PATH"] = conflictingConfigPath;

    saveGlobalConfig(
      makeGlobalConfig({
        canonical: {
          projectId: "canonical",
          path: canonicalRepo,
          storageKey: "storage-canonical",
          displayName: "Canonical",
        },
      }),
      globalConfigPath,
    );

    writeFileSync(
      conflictingConfigPath,
      [
        "projects:",
        "  conflicting:",
        `    path: ${conflictingRepo}`,
        "    runtime: tmux",
        "    agent: claude-code",
        "    workspace: worktree",
        "",
      ].join("\n"),
    );

    const portfolio = getPortfolio();
    expect(portfolio.map((project) => project.id)).toEqual(["canonical"]);
  });
});
