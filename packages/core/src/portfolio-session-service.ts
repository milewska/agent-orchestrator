/**
 * Portfolio session service — lightweight cross-project session aggregation.
 *
 * Reads session metadata files directly without constructing SessionManagers,
 * providing fast portfolio-wide session listing and counts.
 */

import type { PortfolioProject, PortfolioSession, Session, SessionMetadata } from "./types.js";
import { getSessionsDir } from "./paths.js";
import { readMetadata, listMetadata } from "./metadata.js";

const DEFAULT_PER_PROJECT_TIMEOUT_MS = 3_000;

export async function listPortfolioSessions(
  portfolio: PortfolioProject[],
  opts?: { perProjectTimeoutMs?: number },
): Promise<PortfolioSession[]> {
  const timeout = opts?.perProjectTimeoutMs ?? DEFAULT_PER_PROJECT_TIMEOUT_MS;
  const results: PortfolioSession[] = [];

  for (const project of portfolio) {
    if (!project.enabled || project.degraded) continue;

    try {
      const projectResults = await Promise.race([
        loadProjectSessions(project),
        new Promise<PortfolioSession[]>((resolve) =>
          setTimeout(() => resolve([]), timeout),
        ),
      ]);
      results.push(...projectResults);
    } catch {
      // Skip projects whose session dirs can't be read
    }
  }

  return results;
}

async function loadProjectSessions(project: PortfolioProject): Promise<PortfolioSession[]> {
  const results: PortfolioSession[] = [];
  const sessionsDir = getSessionsDir(project.configPath, project.repoPath);
  const sessionIds = listMetadata(sessionsDir);

  for (const sessionId of sessionIds) {
    const metadata = readMetadata(sessionsDir, sessionId);
    if (!metadata) continue;

    const session = metadataToSession(sessionId, project, metadata);
    results.push({ session, project });
  }

  return results;
}

/** Convert raw metadata to a Session object (lightweight, no plugin init) */
function metadataToSession(sessionId: string, project: PortfolioProject, metadata: SessionMetadata): Session {
  return {
    id: sessionId,
    projectId: project.configProjectKey,
    status: (metadata.status as Session["status"]) || "spawning",
    activity: null, // Not available without agent plugin
    branch: metadata.branch || null,
    issueId: metadata.issue || null,
    pr: metadata.pr ? { number: 0, url: metadata.pr, title: "", owner: "", repo: "", branch: "", baseBranch: "", isDraft: false } : null,
    workspacePath: metadata.worktree || null,
    runtimeHandle: metadata.runtimeHandle ? { id: metadata.runtimeHandle, runtimeName: "tmux", data: {} } : null,
    agentInfo: metadata.summary ? { summary: metadata.summary, agentSessionId: null } : null,
    createdAt: metadata.createdAt ? new Date(metadata.createdAt) : new Date(),
    // Use the most recent timestamp available as lastActivityAt
    lastActivityAt: (() => {
      const timestamps = [metadata.createdAt, metadata.restoredAt].filter(Boolean);
      return timestamps.length > 0
        ? new Date(Math.max(...timestamps.map(t => new Date(t!).getTime())))
        : new Date();
    })(),
    restoredAt: metadata.restoredAt ? new Date(metadata.restoredAt) : undefined,
    metadata: {} as Record<string, string>,
  };
}

export async function getPortfolioSessionCounts(portfolio: PortfolioProject[]): Promise<Record<string, { total: number; active: number }>> {
  const counts: Record<string, { total: number; active: number }> = {};
  const TERMINAL = new Set(["killed", "terminated", "done", "cleanup", "errored", "merged"]);

  for (const project of portfolio) {
    if (!project.enabled || project.degraded) {
      counts[project.id] = { total: 0, active: 0 };
      continue;
    }

    try {
      const sessionsDir = getSessionsDir(project.configPath, project.repoPath);
      const sessionIds = listMetadata(sessionsDir);
      let active = 0;

      for (const sessionId of sessionIds) {
        const metadata = readMetadata(sessionsDir, sessionId);
        if (metadata && !TERMINAL.has(metadata.status)) active++;
      }

      counts[project.id] = { total: sessionIds.length, active };
    } catch {
      counts[project.id] = { total: 0, active: 0 };
    }
  }

  return counts;
}
