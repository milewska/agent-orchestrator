import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockEnsureProjectOrchestrator,
  mockGetServices,
  mockGetSCM,
  mockSessionToDashboard,
  mockEnrichSessionPR,
  mockEnrichSessionsMetadata,
  mockListDashboardOrchestrators,
  mockResolveProject,
  mockFilterProjectSessions,
  mockResolveGlobalPause,
} = vi.hoisted(() => ({
  mockEnsureProjectOrchestrator: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetSCM: vi.fn(),
  mockSessionToDashboard: vi.fn(),
  mockEnrichSessionPR: vi.fn(),
  mockEnrichSessionsMetadata: vi.fn(),
  mockListDashboardOrchestrators: vi.fn(),
  mockResolveProject: vi.fn(),
  mockFilterProjectSessions: vi.fn(),
  mockResolveGlobalPause: vi.fn(),
}));

vi.mock("@composio/ao-core", () => ({
  isOrchestratorSession: vi.fn((s: { id: string }) => s.id.startsWith("orch-")),
}));

vi.mock("@/lib/ensure-project-orchestrator", () => ({
  ensureProjectOrchestrator: mockEnsureProjectOrchestrator,
}));

vi.mock("@/lib/services", () => ({
  getServices: mockGetServices,
  getSCM: mockGetSCM,
}));

vi.mock("@/lib/serialize", () => ({
  sessionToDashboard: mockSessionToDashboard,
  enrichSessionPR: mockEnrichSessionPR,
  enrichSessionsMetadata: mockEnrichSessionsMetadata,
  listDashboardOrchestrators: mockListDashboardOrchestrators,
  resolveProject: mockResolveProject,
}));

vi.mock("@/lib/cache", () => ({
  prCache: { get: vi.fn().mockReturnValue(null) },
  prCacheKey: vi.fn((...args: string[]) => args.join("/")),
}));

vi.mock("@/lib/project-utils", () => ({
  filterProjectSessions: mockFilterProjectSessions,
}));

vi.mock("@/lib/global-pause", () => ({
  resolveGlobalPause: mockResolveGlobalPause,
}));

import { loadProjectPageData } from "@/lib/project-page-data";

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureProjectOrchestrator.mockResolvedValue(undefined);
  mockResolveGlobalPause.mockReturnValue(null);
  mockListDashboardOrchestrators.mockReturnValue([]);
  mockEnrichSessionsMetadata.mockResolvedValue(undefined);
});

describe("loadProjectPageData", () => {
  it("returns default empty data when getServices throws", async () => {
    mockGetServices.mockRejectedValue(new Error("no config"));

    const result = await loadProjectPageData("my-app");

    expect(result).toEqual({
      sessions: [],
      sidebarSessions: [],
      globalPause: null,
      orchestrators: [],
    });
  });

  it("loads sessions and filters by project", async () => {
    const coreSessions = [
      { id: "worker-1", status: "working", projectId: "my-app" },
      { id: "worker-2", status: "pr_open", projectId: "my-app" },
    ];

    mockGetServices.mockResolvedValue({
      config: { projects: { "my-app": {} } },
      registry: {},
      sessionManager: { list: vi.fn().mockResolvedValue(coreSessions) },
    });

    mockFilterProjectSessions.mockReturnValue(coreSessions);
    mockSessionToDashboard.mockImplementation((s: { id: string }) => ({
      id: s.id,
      status: "working",
    }));

    const result = await loadProjectPageData("my-app");

    expect(mockFilterProjectSessions).toHaveBeenCalledWith(
      coreSessions,
      "my-app",
      { "my-app": {} },
    );
    expect(result.sessions).toHaveLength(2);
    expect(result.sidebarSessions).toHaveLength(2);
  });

  it("filters out orchestrator sessions from worker list", async () => {
    const coreSessions = [
      { id: "orch-1", status: "working", projectId: "my-app" },
      { id: "worker-1", status: "working", projectId: "my-app" },
    ];

    mockGetServices.mockResolvedValue({
      config: { projects: { "my-app": {} } },
      registry: {},
      sessionManager: { list: vi.fn().mockResolvedValue(coreSessions) },
    });

    mockFilterProjectSessions.mockReturnValue(coreSessions);
    mockSessionToDashboard.mockImplementation((s: { id: string }) => ({
      id: s.id,
      status: "working",
    }));

    const result = await loadProjectPageData("my-app");

    // orchestrator sessions appear in sidebar but not in worker sessions
    expect(result.sidebarSessions).toHaveLength(2);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("worker-1");
  });

  it("continues rendering when ensureProjectOrchestrator fails", async () => {
    mockEnsureProjectOrchestrator.mockRejectedValue(new Error("startup failed"));

    const coreSessions = [
      { id: "worker-1", status: "working", projectId: "my-app" },
    ];

    mockGetServices.mockResolvedValue({
      config: { projects: { "my-app": {} } },
      registry: {},
      sessionManager: { list: vi.fn().mockResolvedValue(coreSessions) },
    });

    mockFilterProjectSessions.mockReturnValue(coreSessions);
    mockSessionToDashboard.mockImplementation((s: { id: string }) => ({
      id: s.id,
      status: "working",
    }));

    const result = await loadProjectPageData("my-app");

    // Should still load sessions despite orchestrator startup failure
    expect(result.sessions).toHaveLength(1);
  });

  it("resolves global pause from all sessions", async () => {
    const coreSessions = [
      { id: "worker-1", status: "working", projectId: "my-app" },
    ];

    mockGetServices.mockResolvedValue({
      config: { projects: { "my-app": {} } },
      registry: {},
      sessionManager: { list: vi.fn().mockResolvedValue(coreSessions) },
    });

    mockFilterProjectSessions.mockReturnValue(coreSessions);
    mockSessionToDashboard.mockReturnValue({ id: "worker-1", status: "working" });
    mockResolveGlobalPause.mockReturnValue({ paused: true, reason: "manual" });

    const result = await loadProjectPageData("my-app");

    expect(mockResolveGlobalPause).toHaveBeenCalledWith(coreSessions);
    expect(result.globalPause).toEqual({ paused: true, reason: "manual" });
  });
});
