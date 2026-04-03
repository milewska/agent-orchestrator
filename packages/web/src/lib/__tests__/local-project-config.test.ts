import { describe, it, expect } from "vitest";
import { buildFlatLocalConfig, extractFlatLocalConfig } from "../local-project-config";

describe("buildFlatLocalConfig", () => {
  it("includes repo when provided", () => {
    const config = buildFlatLocalConfig("https://github.com/org/repo");
    expect(config).toEqual({
      repo: "https://github.com/org/repo",
      defaultBranch: "main",
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
    });
  });

  it("omits repo when not provided", () => {
    const config = buildFlatLocalConfig();
    expect(config).toEqual({
      defaultBranch: "main",
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
    });
    expect(config).not.toHaveProperty("repo");
  });

  it("omits repo when empty string is provided", () => {
    const config = buildFlatLocalConfig("");
    expect(config).not.toHaveProperty("repo");
  });
});

describe("extractFlatLocalConfig", () => {
  it("extracts project config excluding reserved keys", () => {
    const config = {
      projects: {
        "my-app": {
          name: "My App",
          path: "/home/user/app",
          sessionPrefix: "my-app",
          agent: "claude-code",
          runtime: "tmux",
          customField: "value",
        },
      },
    };
    const result = extractFlatLocalConfig(config, "my-app");
    expect(result).toEqual({
      agent: "claude-code",
      runtime: "tmux",
      customField: "value",
    });
    expect(result).not.toHaveProperty("name");
    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("sessionPrefix");
  });

  it("returns empty object when projects key is missing", () => {
    expect(extractFlatLocalConfig({}, "my-app")).toEqual({});
  });

  it("returns empty object when projects is not an object", () => {
    expect(extractFlatLocalConfig({ projects: "invalid" }, "my-app")).toEqual({});
  });

  it("returns empty object when project key is not found", () => {
    const config = { projects: { other: { agent: "aider" } } };
    expect(extractFlatLocalConfig(config, "my-app")).toEqual({});
  });

  it("returns empty object when project value is not an object", () => {
    const config = { projects: { "my-app": null } };
    expect(extractFlatLocalConfig(config as Record<string, unknown>, "my-app")).toEqual({});
  });
});
