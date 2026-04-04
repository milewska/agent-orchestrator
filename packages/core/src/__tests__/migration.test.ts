/**
 * Tests for buildEffectiveConfig (migration.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

import { buildEffectiveConfig } from "../migration.js";
import { saveGlobalConfig, saveShadowFile, type GlobalConfig } from "../global-config.js";

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = join(tmpdir(), `ao-migration-test-${randomBytes(6).toString("hex")}`);
  mkdirSync(testDir, { recursive: true });
  originalEnv = process.env["AO_GLOBAL_CONFIG_PATH"];
  process.env["AO_GLOBAL_CONFIG_PATH"] = join(testDir, ".ao", "config.yaml");
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env["AO_GLOBAL_CONFIG_PATH"] = originalEnv;
  } else {
    delete process.env["AO_GLOBAL_CONFIG_PATH"];
  }
  rmSync(testDir, { recursive: true, force: true });
});

function makeGlobalConfig(projects: Record<string, { name: string; path: string }>): GlobalConfig {
  return {
    port: 3000,
    readyThresholdMs: 300000,
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
    projects,
  };
}

describe("buildEffectiveConfig", () => {
  it("sets configMode to global-only when no local config exists", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);
    saveShadowFile("app", { repo: "org/app" });

    const result = buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"));
    expect(result.projects["app"].configMode).toBe("global-only");
  });

  it("sets configMode to hybrid when local config exists", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    writeFileSync(
      join(projectDir, "agent-orchestrator.yaml"),
      stringifyYaml({ repo: "org/app", defaultBranch: "main" }),
    );
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);

    const result = buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"));
    expect(result.projects["app"].configMode).toBe("hybrid");
  });

  it("gracefully handles non-object tracker field from shadow (type guard)", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);
    // Corrupt shadow: tracker is a string instead of an object
    saveShadowFile("app", { repo: "org/app", tracker: "not-an-object" });

    const result = buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"));
    // Should be undefined (type guard rejects non-objects) rather than a wrong-type value
    expect(result.projects["app"].tracker).toBeUndefined();
  });

  it("gracefully handles non-array symlinks field from shadow (type guard)", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);
    saveShadowFile("app", { repo: "org/app", symlinks: "not-an-array" });

    const result = buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"));
    expect(result.projects["app"].symlinks).toBeUndefined();
  });

  it("gracefully handles non-string runtime field from shadow (type guard)", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);
    saveShadowFile("app", { repo: "org/app", runtime: 42 });

    const result = buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"));
    expect(result.projects["app"].runtime).toBeUndefined();
  });

  it("surfaces a warning when hybrid local config is invalid", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    // Write a broken YAML file (valid YAML but invalid project config)
    writeFileSync(
      join(projectDir, "agent-orchestrator.yaml"),
      "!!invalid yaml: [unclosed",
    );
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);
    saveShadowFile("app", { repo: "org/app-shadow" });

    const warnings: string[] = [];
    const result = buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"), warnings);

    // Should fall back to shadow and warn
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("app");
    expect(warnings[0]).toContain("local config");
    // Fallback shadow is used
    expect(result.projects["app"].repo).toBe("org/app-shadow");
  });

  it("does not push warnings when local config is valid", () => {
    const projectDir = join(testDir, "my-app");
    mkdirSync(projectDir);
    writeFileSync(
      join(projectDir, "agent-orchestrator.yaml"),
      stringifyYaml({ repo: "org/app", defaultBranch: "main" }),
    );
    const gc = makeGlobalConfig({ app: { name: "App", path: projectDir } });
    saveGlobalConfig(gc);

    const warnings: string[] = [];
    buildEffectiveConfig(gc, join(testDir, ".ao", "config.yaml"), warnings);
    expect(warnings).toHaveLength(0);
  });
});
