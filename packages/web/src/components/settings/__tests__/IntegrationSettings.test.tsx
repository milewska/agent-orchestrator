import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IntegrationSettings } from "../IntegrationSettings";

describe("IntegrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(<IntegrationSettings />);
    expect(screen.getByText("Checking connections...")).toBeInTheDocument();
  });

  it("renders connected integrations", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integrations: [
          { name: "GitHub", connected: true, details: "org/repo" },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(screen.getByText("org/repo")).toBeInTheDocument();
    });
  });

  it("renders disconnected integrations with config hint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integrations: [
          { name: "GitHub", connected: false },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getByText("Disconnected")).toBeInTheDocument();
      expect(screen.getByText("gh auth login")).toBeInTheDocument();
    });
  });

  it("shows Linear config hint for non-GitHub integrations", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integrations: [
          { name: "Linear", connected: false },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("export LINEAR_API_KEY=...")).toBeInTheDocument();
    });
  });

  it("shows error message when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("shows error from non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unauthorized" }),
    }) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    });
  });

  it("shows empty state when no integrations returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ integrations: [] }),
    }) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("No integrations detected.")).toBeInTheDocument();
    });
  });

  it("renders heading and description", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ integrations: [] }),
    }) as unknown as typeof fetch;

    render(<IntegrationSettings />);

    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByText("Connection status for external services.")).toBeInTheDocument();
  });
});
