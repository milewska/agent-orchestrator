import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentSettings } from "../AgentSettings";

describe("AgentSettings", () => {
  it("renders heading and description", () => {
    render(<AgentSettings />);

    expect(screen.getByText("Agent Defaults")).toBeInTheDocument();
    expect(
      screen.getByText(/Default settings for new agent sessions/),
    ).toBeInTheDocument();
  });

  it("renders default values when no props provided", () => {
    render(<AgentSettings />);

    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("worktree")).toBeInTheDocument();
  });

  it("renders custom values from props", () => {
    render(
      <AgentSettings
        defaultAgent="codex"
        defaultPermissions="permissionless"
        workspaceStrategy="clone"
      />,
    );

    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("permissionless")).toBeInTheDocument();
    expect(screen.getByText("clone")).toBeInTheDocument();
  });

  it("renders all three setting cards with labels", () => {
    render(<AgentSettings />);

    expect(screen.getByText("Default Agent")).toBeInTheDocument();
    expect(screen.getByText("Default Permissions")).toBeInTheDocument();
    expect(screen.getByText("Workspace Strategy")).toBeInTheDocument();
  });

  it("renders descriptions for each setting", () => {
    render(<AgentSettings />);

    expect(screen.getByText(/The agent runtime used for new sessions/)).toBeInTheDocument();
    expect(screen.getByText(/Permission level for new agent sessions/)).toBeInTheDocument();
    expect(screen.getByText(/How the agent's working copy is created/)).toBeInTheDocument();
  });

  it("shows config file hint at the bottom", () => {
    render(<AgentSettings />);

    expect(screen.getByText(/To change these defaults/)).toBeInTheDocument();
    expect(screen.getByText("ao.yaml")).toBeInTheDocument();
  });
});
