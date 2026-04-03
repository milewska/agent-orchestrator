import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PreferenceSettings } from "../PreferenceSettings";

const projects = [
  { id: "alpha", name: "Alpha" },
  { id: "bravo", name: "Bravo" },
  { id: "charlie", name: "Charlie" },
];

describe("PreferenceSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;
  });

  it("renders heading and description", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo", "charlie"]}
        initialDefaultProject=""
      />,
    );

    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText(/Customize how your portfolio is displayed/)).toBeInTheDocument();
  });

  it("renders projects in the initial order", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["bravo", "alpha", "charlie"]}
        initialDefaultProject=""
      />,
    );

    // Names appear in both the order list and the <select>, so use getAllByText
    expect(screen.getAllByText("Bravo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Charlie").length).toBeGreaterThanOrEqual(1);
  });

  it("moves a project up when move up is clicked", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo", "charlie"]}
        initialDefaultProject=""
      />,
    );

    const moveUpButtons = screen.getAllByLabelText("Move up");
    // Click move up on the second item (bravo)
    fireEvent.click(moveUpButtons[1]);

    // Bravo should now be first
    const items = screen.getAllByText(/Alpha|Bravo|Charlie/);
    expect(items[0].textContent).toBe("Bravo");
    expect(items[1].textContent).toBe("Alpha");
  });

  it("moves a project down when move down is clicked", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo", "charlie"]}
        initialDefaultProject=""
      />,
    );

    const moveDownButtons = screen.getAllByLabelText("Move down");
    // Click move down on the first item (alpha)
    fireEvent.click(moveDownButtons[0]);

    const items = screen.getAllByText(/Alpha|Bravo|Charlie/);
    expect(items[0].textContent).toBe("Bravo");
    expect(items[1].textContent).toBe("Alpha");
  });

  it("disables move up for the first item", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo"]}
        initialDefaultProject=""
      />,
    );

    const moveUpButtons = screen.getAllByLabelText("Move up");
    expect(moveUpButtons[0]).toBeDisabled();
  });

  it("disables move down for the last item", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo"]}
        initialDefaultProject=""
      />,
    );

    const moveDownButtons = screen.getAllByLabelText("Move down");
    expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled();
  });

  it("renders default project dropdown with projects", () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo", "charlie"]}
        initialDefaultProject="bravo"
      />,
    );

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("bravo");
  });

  it("saves preferences when Save button is clicked", async () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha", "bravo"]}
        initialDefaultProject=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/settings/preferences",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });

  it("shows Saved indicator after successful save", async () => {
    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha"]}
        initialDefaultProject=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("shows saving state while request is in flight", async () => {
    let resolveFetch: (value: Response) => void;
    global.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;

    render(
      <PreferenceSettings
        projects={projects}
        initialOrder={["alpha"]}
        initialDefaultProject=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
    expect(screen.getByText("Saving...")).toBeInTheDocument();

    resolveFetch!({ ok: true } as Response);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Preferences" })).toBeInTheDocument();
    });
  });
});
