import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfigFile, loadConfig } from "../config.js";

describe("findConfigFile", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns AO_CONFIG_PATH even when the file has malformed YAML", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "config-test-"));
    try {
      const malformedPath = join(tempRoot, "broken.yaml");
      writeFileSync(malformedPath, "{{invalid yaml::");
      process.env = { ...originalEnv, AO_CONFIG_PATH: malformedPath };

      expect(findConfigFile()).toBe(malformedPath);
      expect(() => loadConfig()).toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("ignores AO_CONFIG_PATH when it points to a flat local config", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "config-test-"));
    try {
      const flatPath = join(tempRoot, "agent-orchestrator.yaml");
      const fallbackDir = join(tempRoot, "fallback");
      const wrappedPath = join(fallbackDir, "agent-orchestrator.yaml");
      writeFileSync(flatPath, "repo: acme/demo\nagent: codex\n");
      // Create a separate discovery location with a wrapped config.
      // `startDir` participates after search-up from cwd, so it must be a directory.
      // The temp root itself intentionally contains only a flat config.
      // The fallback dir simulates a valid wrapped config available via explicit startDir.
      mkdirSync(fallbackDir, { recursive: true });
      writeFileSync(wrappedPath, "projects: {}\n");
      process.env = { ...originalEnv, AO_CONFIG_PATH: flatPath };

      expect(findConfigFile(fallbackDir)).toBe(wrappedPath);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
