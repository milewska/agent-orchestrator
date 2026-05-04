import { describe, expect, it } from "vitest";
import {
  isUserInitiatedSpawnAllowed,
  reactionConfigForAutonomyMode,
  resolveAutonomyMode,
} from "../autonomy-mode.js";
import type { ProjectConfig, ReactionConfig } from "../types.js";

const baseProject: ProjectConfig = {
  name: "My App",
  repo: "org/my-app",
  path: "/tmp/my-app",
  defaultBranch: "main",
  sessionPrefix: "app",
};

const sendToAgentReaction: ReactionConfig = {
  auto: true,
  action: "send-to-agent",
  message: "Fix CI.",
};

describe("autonomy mode helpers", () => {
  it("defaults omitted autonomyMode to manual", () => {
    expect(resolveAutonomyMode(baseProject)).toBe("manual");
    expect(resolveAutonomyMode(undefined)).toBe("manual");
  });

  it("allows user-initiated spawns for manual projects but denies automatic ones", () => {
    const project: ProjectConfig = { ...baseProject, autonomyMode: "manual" };

    expect(isUserInitiatedSpawnAllowed(project, false)).toBe(false);
    expect(isUserInitiatedSpawnAllowed(project, true)).toBe(true);
  });

  it("allows automatic spawns for review and full projects", () => {
    expect(isUserInitiatedSpawnAllowed({ ...baseProject, autonomyMode: "review" }, false)).toBe(
      true,
    );
    expect(isUserInitiatedSpawnAllowed({ ...baseProject, autonomyMode: "full" }, false)).toBe(true);
  });

  it("preserves automatic agent reactions in full mode", () => {
    expect(
      reactionConfigForAutonomyMode({ ...baseProject, autonomyMode: "full" }, sendToAgentReaction),
    ).toEqual(sendToAgentReaction);
  });

  it("routes automatic agent reactions to notify in review mode", () => {
    const reaction = reactionConfigForAutonomyMode(
      { ...baseProject, autonomyMode: "review" },
      sendToAgentReaction,
    );

    expect(reaction).toMatchObject({
      auto: true,
      action: "notify",
      message: "Fix CI.",
      priority: "action",
    });
  });

  it("also suppresses automatic agent reactions when autonomyMode is omitted", () => {
    const reaction = reactionConfigForAutonomyMode(baseProject, {
      auto: true,
      action: "send-to-agent",
    });

    expect(reaction).toMatchObject({
      action: "notify",
      priority: "action",
    });
    expect(reaction.message).toContain("autonomyMode is 'manual'");
  });
});
