import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSettings } from "../ProjectSettings";

// Mock AddProjectModal to avoid pulling in the full modal tree
vi.mock("../../AddProjectModal", () => ({
  AddProjectModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="add-project-modal"><button onClick={onClose}>Close</button></div> : null,
}));

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "My Project",
    repoPath: "/home/user/repos/my-project",
    configPath: "/home/user/repos/my-project/ao.yaml",
    defaultBranch: "main",
    sessionPrefix: "mp",
    enabled: true,
    pinned: false,
    source: "local",
    ...overrides,
  };
}

describe("ProjectSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders heading and description", () => {
    render(<ProjectSettings projects={[]} />);

    expect(screen.getByText("Projects & Repos")).toBeInTheDocument();
    expect(screen.getByText(/Manage which projects appear/)).toBeInTheDocument();
  });

  it("shows empty state when no projects", () => {
    render(<ProjectSettings projects={[]} />);

    expect(screen.getByText("No projects registered yet.")).toBeInTheDocument();
  });

  it("renders project details", () => {
    render(<ProjectSettings projects={[makeProject()]} />);

    expect(screen.getByText("My Project")).toBeInTheDocument();
    expect(screen.getByText("/home/user/repos/my-project")).toBeInTheDocument();
    expect(screen.getByText("Branch: main")).toBeInTheDocument();
    expect(screen.getByText("Prefix: mp")).toBeInTheDocument();
    expect(screen.getByText("Source: local")).toBeInTheDocument();
  });

  it("shows PINNED badge for pinned projects", () => {
    render(<ProjectSettings projects={[makeProject({ pinned: true })]} />);

    expect(screen.getByText("PINNED")).toBeInTheDocument();
  });

  it("shows DISABLED badge for disabled projects", () => {
    render(<ProjectSettings projects={[makeProject({ enabled: false })]} />);

    expect(screen.getByText("DISABLED")).toBeInTheDocument();
  });

  it("toggles pin state when Pin button is clicked", async () => {
    render(<ProjectSettings projects={[makeProject()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/proj-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ pinned: true }),
        }),
      );
    });
  });

  it("toggles enabled state when Disable button is clicked", async () => {
    render(<ProjectSettings projects={[makeProject()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/proj-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });
  });

  it("shows Enable button for disabled projects", () => {
    render(<ProjectSettings projects={[makeProject({ enabled: false })]} />);

    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("shows Unpin button for pinned projects", () => {
    render(<ProjectSettings projects={[makeProject({ pinned: true })]} />);

    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("removes project when Remove is clicked and confirmed", async () => {
    render(<ProjectSettings projects={[makeProject()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/proj-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    // After removal, should show empty state
    await waitFor(() => {
      expect(screen.getByText("No projects registered yet.")).toBeInTheDocument();
    });
  });

  it("does not remove project when confirm is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ProjectSettings projects={[makeProject()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("opens add project modal when + Add Project is clicked", () => {
    render(<ProjectSettings projects={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add Project" }));
    expect(screen.getByTestId("add-project-modal")).toBeInTheDocument();
  });
});
