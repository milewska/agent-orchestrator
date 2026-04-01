import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portfolio-services", () => ({
  getPortfolioServices: () => ({
    portfolio: [
      {
        id: "bravo",
        name: "Bravo",
        enabled: true,
        degraded: false,
      },
      {
        id: "alpha",
        name: "Alpha",
        enabled: true,
        degraded: false,
      },
      {
        id: "charlie",
        name: "Charlie",
        enabled: true,
        degraded: false,
      },
    ],
    preferences: {
      version: 1,
      projectOrder: ["bravo", "alpha"],
    },
  }),
  getCachedPortfolioSessions: vi.fn(async () => []),
}));

vi.mock("@/lib/serialize", () => ({
  sessionToDashboard: vi.fn(),
}));

vi.mock("@composio/ao-core", () => ({
  isOrchestratorSession: vi.fn(() => false),
}));

describe("loadPortfolioPageData", () => {
  it("preserves the portfolio order provided by the registry services", async () => {
    const { loadPortfolioPageData } = await import("../portfolio-page-data");

    const { projectSummaries } = await loadPortfolioPageData();

    expect(projectSummaries.map((project) => project.id)).toEqual(["bravo", "alpha", "charlie"]);
  });
});
