import type { AutonomyMode, ProjectConfig, ReactionConfig } from "./types.js";

export function resolveAutonomyMode(
  project: Pick<ProjectConfig, "autonomyMode"> | undefined,
): AutonomyMode {
  return project?.autonomyMode ?? "manual";
}

export function isUserInitiatedSpawnAllowed(
  project: Pick<ProjectConfig, "autonomyMode"> | undefined,
  userInitiated: boolean,
): boolean {
  return resolveAutonomyMode(project) !== "manual" || userInitiated;
}

export function reactionConfigForAutonomyMode(
  project: Pick<ProjectConfig, "autonomyMode"> | undefined,
  reactionConfig: ReactionConfig,
): ReactionConfig {
  const mode = resolveAutonomyMode(project);
  if (mode === "full" || reactionConfig.action === "notify") {
    return reactionConfig;
  }

  return {
    ...reactionConfig,
    action: "notify",
    message:
      reactionConfig.message ??
      `Automatic '${reactionConfig.action ?? "notify"}' reaction suppressed because autonomyMode is '${mode}'. Review manually.`,
    priority: reactionConfig.priority ?? "action",
  };
}
