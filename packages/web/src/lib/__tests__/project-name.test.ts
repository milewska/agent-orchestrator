import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadConfig, mockGetGlobalConfigPath, MockConfigNotFoundError } = vi.hoisted(() => {
  const mockLoadConfig = vi.fn();
  const mockGetGlobalConfigPath = vi.fn(() => "/tmp/global-config.yaml");
  class MockConfigNotFoundError extends Error {
    constructor(message?: string) {
      super(message ?? "Config not found");
      this.name = "ConfigNotFoundError";
    }
  }

  return { mockLoadConfig, mockGetGlobalConfigPath, MockConfigNotFoundError };
});

vi.mock("@aoagents/ao-core", () => ({
  loadConfig: mockLoadConfig,
  getGlobalConfigPath: mockGetGlobalConfigPath,
  ConfigNotFoundError: MockConfigNotFoundError,
}));

describe("project-name fallback discovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    mockLoadConfig.mockReset();
    mockGetGlobalConfigPath.mockClear();
    mockGetGlobalConfigPath.mockReturnValue("/tmp/global-config.yaml");
  });

  it("falls back to discovered local config when the canonical global config is missing", async () => {
    const fallbackConfig = {
      projects: {
        mono: { name: "Mono", sessionPrefix: "mono" },
      },
      degradedProjects: {},
    };

    mockLoadConfig
      .mockImplementationOnce(() => {
        const error = new Error("ENOENT: no such file or directory");
        (error as Error & { code?: string }).code = "ENOENT";
        throw error;
      })
      .mockReturnValueOnce(fallbackConfig)
      .mockReturnValue(fallbackConfig);

    const { getAllProjects, getPrimaryProjectId, getProjectName } = await import("../project-name");

    expect(getAllProjects()).toEqual([{ id: "mono", name: "Mono", sessionPrefix: "mono" }]);
    expect(getPrimaryProjectId()).toBe("mono");
    expect(getProjectName()).toBe("Mono");
    expect(mockLoadConfig).toHaveBeenNthCalledWith(1, "/tmp/global-config.yaml");
    expect(mockLoadConfig).toHaveBeenNthCalledWith(2);
  });

  it("prefers the current repo project over the first configured project", async () => {
    const config = {
      projects: {
        "vinesight-web": {
          name: "vinesight-web",
          path: "/Users/ashishhuddar/vinesight",
          sessionPrefix: "vw",
        },
        "agent-orchestrator": {
          name: "Agent Orchestrator",
          path: "/Users/ashishhuddar/agent-orchestrator",
          sessionPrefix: "ao",
        },
      },
      degradedProjects: {},
    };

    mockLoadConfig.mockReturnValue(config);
    vi.spyOn(process, "cwd").mockReturnValue("/Users/ashishhuddar/agent-orchestrator");

    const { getPrimaryProjectId, getProjectName } = await import("../project-name");

    expect(getPrimaryProjectId()).toBe("agent-orchestrator");
    expect(getProjectName()).toBe("Agent Orchestrator");
  });
});
