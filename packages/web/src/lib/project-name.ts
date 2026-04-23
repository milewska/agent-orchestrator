import "server-only";

import { cache } from "react";
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { ConfigNotFoundError, getGlobalConfigPath, loadConfig } from "@aoagents/ao-core";

export interface ProjectInfo {
  id: string;
  name: string;
  sessionPrefix?: string;
  resolveError?: string;
}

function loadProjectDiscoveryConfig() {
  const globalConfigPath = getGlobalConfigPath();

  try {
    return loadConfig(globalConfigPath);
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      return loadConfig();
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return loadConfig();
    }
    throw error;
  }
}

function getCanonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function findCurrentRepoProjectId(): string | undefined {
  try {
    const config = loadProjectDiscoveryConfig();
    const cwd = getCanonicalPath(process.cwd());

    for (const [projectId, project] of Object.entries(config.projects)) {
      if (typeof project.path !== "string") continue;
      if (getCanonicalPath(project.path) === cwd) {
        return projectId;
      }
    }

    const cwdBase = basename(cwd);
    const basenameMatch = Object.entries(config.projects).find(([, project]) => {
      return typeof project.path === "string" && basename(project.path) === cwdBase;
    });
    return basenameMatch?.[0];
  } catch {
    return undefined;
  }
}

export const getProjectName = cache((): string => {
  try {
    const config = loadProjectDiscoveryConfig();
    const currentProjectId = findCurrentRepoProjectId();
    if (currentProjectId) {
      const currentProject = config.projects[currentProjectId];
      return currentProject?.name ?? currentProjectId;
    }
    const firstKey = Object.keys(config.projects)[0];
    if (firstKey) {
      const name = config.projects[firstKey].name ?? firstKey;
      return name || firstKey || "ao";
    }
  } catch {
    // Config not available
  }
  return "ao";
});

export const getPrimaryProjectId = cache((): string => {
  const currentProjectId = findCurrentRepoProjectId();
  if (currentProjectId) return currentProjectId;

  try {
    const config = loadProjectDiscoveryConfig();
    const firstKey = Object.keys(config.projects)[0];
    if (firstKey) return firstKey;
  } catch {
    // Config not available
  }
  return "ao";
});

export const getAllProjects = cache((): ProjectInfo[] => {
  try {
    const config = loadProjectDiscoveryConfig();
    return [
      ...Object.entries(config.projects).map(([id, project]) => ({
        id,
        name: project.name ?? id,
        sessionPrefix: project.sessionPrefix ?? id,
      })),
      ...Object.entries(config.degradedProjects).map(([id, project]) => ({
        id,
        name: id,
        sessionPrefix: id,
        resolveError: project.resolveError,
      })),
    ];
  } catch {
    return [];
  }
});
