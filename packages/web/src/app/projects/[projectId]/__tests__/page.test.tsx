import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/components/Dashboard", () => ({
  Dashboard: (props: Record<string, unknown>) => (
    <div data-testid="dashboard" data-project-id={props.projectId} />
  ),
}));

vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: (props: { children: React.ReactNode }) => (
    <div data-testid="dashboard-shell">{props.children}</div>
  ),
}));

vi.mock("@/lib/project-name", () => ({
  getAllProjects: vi.fn(),
}));

vi.mock("@/lib/project-page-data", () => ({
  loadProjectPageData: vi.fn(),
}));

vi.mock("@/lib/portfolio-page-data", () => ({
  loadPortfolioPageData: vi.fn(),
}));

vi.mock("@/lib/default-location", () => ({
  getDefaultCloneLocation: vi.fn().mockReturnValue("/home/user"),
}));

import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getAllProjects } from "@/lib/project-name";
import { loadProjectPageData } from "@/lib/project-page-data";
import { loadPortfolioPageData } from "@/lib/portfolio-page-data";
import ProjectPage, { generateMetadata } from "../page";

const mockGetAllProjects = vi.mocked(getAllProjects);
const mockLoadProjectPageData = vi.mocked(loadProjectPageData);
const mockLoadPortfolioPageData = vi.mocked(loadPortfolioPageData);
const mockNotFound = vi.mocked(notFound);

const fakePageData = {
  sessions: [],
  sidebarSessions: [],
  globalPause: null,
  orchestrators: [],
};

const fakePortfolioData = {
  projectSummaries: [],
  sessions: [],
};

const fakeProjects = [
  { id: "my-app", name: "My App" },
  { id: "other", name: "Other Project" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllProjects.mockReturnValue(fakeProjects);
  mockLoadProjectPageData.mockResolvedValue(fakePageData);
  mockLoadPortfolioPageData.mockResolvedValue(fakePortfolioData);
  mockNotFound.mockImplementation((() => {
    throw new Error("NOT_FOUND");
  }) as unknown as typeof notFound);
});

describe("ProjectPage", () => {
  it("renders DashboardShell and Dashboard for a valid project", async () => {
    render(
      await ProjectPage({ params: Promise.resolve({ projectId: "my-app" }) }),
    );

    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard")).toHaveAttribute(
      "data-project-id",
      "my-app",
    );
  });

  it("calls notFound when project does not exist", async () => {
    await ProjectPage({ params: Promise.resolve({ projectId: "nonexistent" }) }).catch(() => {});

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("loads project page data and portfolio data", async () => {
    render(
      await ProjectPage({ params: Promise.resolve({ projectId: "my-app" }) }),
    );

    expect(mockLoadProjectPageData).toHaveBeenCalledWith("my-app");
    expect(mockLoadPortfolioPageData).toHaveBeenCalled();
  });
});

describe("generateMetadata", () => {
  it("returns title with project name", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ projectId: "my-app" }),
    });

    expect(metadata.title).toEqual({ absolute: "ao | My App" });
  });

  it("falls back to projectId when project is not found", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ projectId: "unknown" }),
    });

    expect(metadata.title).toEqual({ absolute: "ao | unknown" });
  });
});
