import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
const mockGetSessionManager = vi.fn();
const mockEnsureLifecycleWorker = vi.fn();
const mockAddProjectToRunning = vi.fn();
const mockRemoveProjectFromRunning = vi.fn();
const activeWorkers = new Set<string>();

vi.mock("@aoagents/ao-core", () => ({
  getGlobalConfigPath: () => "/tmp/global-config.yaml",
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  isTerminalSession: (session: { status: string; activity: string | null }) =>
    ["done", "killed", "terminated", "errored", "merged", "cleanup"].includes(session.status) ||
    session.activity === "exited",
}));

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: (...args: unknown[]) => mockGetSessionManager(...args),
}));

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  ensureLifecycleWorker: async (...args: unknown[]) => {
    const projectId = args[1] as string;
    const result = await mockEnsureLifecycleWorker(...args);
    activeWorkers.add(projectId);
    return result;
  },
  stopLifecycleWorker: (projectId: string) => {
    activeWorkers.delete(projectId);
  },
  listLifecycleWorkers: () => Array.from(activeWorkers),
}));

vi.mock("../../src/lib/running-state.js", () => ({
  addProjectToRunning: (...args: unknown[]) => mockAddProjectToRunning(...args),
  removeProjectFromRunning: (...args: unknown[]) => mockRemoveProjectFromRunning(...args),
}));

import { reconcileProjectSupervisor } from "../../src/lib/project-supervisor.js";

function makeConfig(projectIds: string[]) {
  return {
    configPath: "/tmp/global-config.yaml",
    projects: Object.fromEntries(projectIds.map((id) => [id, { name: id, path: `/tmp/${id}` }])),
  };
}

function makeSession(projectId: string, status = "working") {
  return { id: `${projectId}-1`, projectId, status, activity: null };
}

describe("project-supervisor", () => {
  let sessionsByProject: Map<string, unknown[]>;

  beforeEach(() => {
    activeWorkers.clear();
    sessionsByProject = new Map();
    mockLoadConfig.mockReset();
    mockGetSessionManager.mockReset();
    mockEnsureLifecycleWorker.mockReset();
    mockAddProjectToRunning.mockReset();
    mockRemoveProjectFromRunning.mockReset();
    mockLoadConfig.mockReturnValue(makeConfig(["app"]));
    mockGetSessionManager.mockResolvedValue({
      list: async (projectId: string) => sessionsByProject.get(projectId) ?? [],
    });
    mockEnsureLifecycleWorker.mockResolvedValue({ running: true, started: true });
  });

  it("attaches a worker for a globally registered project with a non-terminal session", async () => {
    sessionsByProject.set("app", [makeSession("app")]);

    await reconcileProjectSupervisor();

    expect(mockEnsureLifecycleWorker).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: "/tmp/global-config.yaml" }),
      "app",
      undefined,
    );
    expect(mockAddProjectToRunning).toHaveBeenCalledWith("app");
    expect(activeWorkers.has("app")).toBe(true);
  });

  it("does not attach for a registered project with no non-terminal sessions", async () => {
    sessionsByProject.set("app", [makeSession("app", "done")]);

    await reconcileProjectSupervisor();

    expect(mockEnsureLifecycleWorker).not.toHaveBeenCalled();
    expect(mockAddProjectToRunning).not.toHaveBeenCalled();
  });

  it("detaches a worker when the project is removed from global config", async () => {
    activeWorkers.add("removed");
    mockLoadConfig.mockReturnValue(makeConfig(["app"]));

    await reconcileProjectSupervisor();

    expect(activeWorkers.has("removed")).toBe(false);
    expect(mockRemoveProjectFromRunning).toHaveBeenCalledWith("removed");
  });

  it("detaches a worker when the last session becomes terminal", async () => {
    activeWorkers.add("app");
    sessionsByProject.set("app", [makeSession("app", "done")]);

    await reconcileProjectSupervisor();

    expect(activeWorkers.has("app")).toBe(false);
    expect(mockRemoveProjectFromRunning).toHaveBeenCalledWith("app");
  });

  it("updates running.projects for attached and detached workers", async () => {
    activeWorkers.add("idle");
    mockLoadConfig.mockReturnValue(makeConfig(["active", "idle"]));
    sessionsByProject.set("active", [makeSession("active")]);
    sessionsByProject.set("idle", [makeSession("idle", "done")]);

    await reconcileProjectSupervisor();

    expect(mockAddProjectToRunning).toHaveBeenCalledWith("active");
    expect(mockRemoveProjectFromRunning).toHaveBeenCalledWith("idle");
    expect(activeWorkers.has("active")).toBe(true);
    expect(activeWorkers.has("idle")).toBe(false);
  });

  it("continues reconciling other projects when one project fails", async () => {
    mockLoadConfig.mockReturnValue(makeConfig(["broken", "healthy"]));
    sessionsByProject.set("healthy", [makeSession("healthy")]);
    mockGetSessionManager.mockResolvedValue({
      list: async (projectId: string) => {
        if (projectId === "broken") throw new Error("boom");
        return sessionsByProject.get(projectId) ?? [];
      },
    });

    await reconcileProjectSupervisor();

    expect(mockEnsureLifecycleWorker).toHaveBeenCalledWith(
      expect.anything(),
      "healthy",
      undefined,
    );
    expect(activeWorkers.has("healthy")).toBe(true);
  });
});
