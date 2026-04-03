import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: (props: { children: React.ReactNode }) => (
    <div data-testid="dashboard-shell">{props.children}</div>
  ),
}));

vi.mock("@/components/ProjectSessionPageClient", () => ({
  ProjectSessionPageClient: (props: { projectId: string; sessionId: string }) => (
    <div
      data-testid="session-client"
      data-project-id={props.projectId}
      data-session-id={props.sessionId}
    />
  ),
}));

vi.mock("@/lib/default-location", () => ({
  getDefaultCloneLocation: vi.fn().mockReturnValue("/home/user"),
}));

vi.mock("@/lib/project-page-data", () => ({
  loadProjectPageData: vi.fn(),
}));

vi.mock("@/lib/portfolio-page-data", () => ({
  loadPortfolioPageData: vi.fn(),
}));

import { render, screen } from "@testing-library/react";
import { loadProjectPageData } from "@/lib/project-page-data";
import { loadPortfolioPageData } from "@/lib/portfolio-page-data";
import ProjectSessionPage from "../page";

const mockLoadProjectPageData = vi.mocked(loadProjectPageData);
const mockLoadPortfolioPageData = vi.mocked(loadPortfolioPageData);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadProjectPageData.mockResolvedValue({
    sessions: [],
    sidebarSessions: [],
    globalPause: null,
    orchestrators: [],
  });
  mockLoadPortfolioPageData.mockResolvedValue({
    projectSummaries: [],
    sessions: [],
  });
});

describe("ProjectSessionPage", () => {
  it("renders DashboardShell wrapping ProjectSessionPageClient", async () => {
    render(
      await ProjectSessionPage({
        params: Promise.resolve({ projectId: "my-app", sessionId: "sess-1" }),
      }),
    );

    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    const client = screen.getByTestId("session-client");
    expect(client).toHaveAttribute("data-project-id", "my-app");
    expect(client).toHaveAttribute("data-session-id", "sess-1");
  });

  it("loads project and portfolio data concurrently", async () => {
    render(
      await ProjectSessionPage({
        params: Promise.resolve({ projectId: "proj-2", sessionId: "sess-x" }),
      }),
    );

    expect(mockLoadProjectPageData).toHaveBeenCalledWith("proj-2");
    expect(mockLoadPortfolioPageData).toHaveBeenCalled();
  });
});
