import {
  loadConfig,
  getGlobalConfigPath,
  isTerminalSession,
  type OrchestratorConfig,
} from "@aoagents/ao-core";
import { getSessionManager } from "./create-session-manager.js";
import {
  ensureLifecycleWorker,
  listLifecycleWorkers,
  stopLifecycleWorker,
} from "./lifecycle-service.js";
import { addProjectToRunning, removeProjectFromRunning } from "./running-state.js";

const DEFAULT_SUPERVISOR_INTERVAL_MS = 60_000;

interface SupervisorHandle {
  stop: () => void;
  reconcileNow: () => Promise<void>;
}

let activeSupervisor: SupervisorHandle | null = null;

export interface ReconcileProjectSupervisorOptions {
  intervalMs?: number;
}

async function projectHasNonTerminalSession(
  config: OrchestratorConfig,
  projectId: string,
): Promise<boolean> {
  const sm = await getSessionManager(config);
  const sessions = await sm.list(projectId);
  return sessions.some((session) => !isTerminalSession(session));
}

export async function reconcileProjectSupervisor(
  options: ReconcileProjectSupervisorOptions = {},
): Promise<void> {
  const config = loadConfig(getGlobalConfigPath());
  const configuredProjectIds = new Set(Object.keys(config.projects));
  const activeProjectIds = new Set(listLifecycleWorkers());

  for (const projectId of activeProjectIds) {
    if (!configuredProjectIds.has(projectId)) {
      stopLifecycleWorker(projectId);
      await removeProjectFromRunning(projectId);
    }
  }

  for (const projectId of configuredProjectIds) {
    try {
      const hasNonTerminalSession = await projectHasNonTerminalSession(config, projectId);
      const isAttached = listLifecycleWorkers().includes(projectId);

      if (hasNonTerminalSession && !isAttached) {
        await ensureLifecycleWorker(config, projectId, options.intervalMs);
        await addProjectToRunning(projectId);
      } else if (!hasNonTerminalSession && isAttached) {
        stopLifecycleWorker(projectId);
        await removeProjectFromRunning(projectId);
      }
    } catch {
      // Best-effort per project: a broken project must not block others from reconciling.
    }
  }
}

export async function startProjectSupervisor(
  intervalMs: number = DEFAULT_SUPERVISOR_INTERVAL_MS,
): Promise<SupervisorHandle> {
  if (activeSupervisor) return activeSupervisor;

  let reconciling = false;
  let pending = false;
  let stopped = false;

  const run = async (): Promise<void> => {
    if (stopped) return;
    if (reconciling) {
      pending = true;
      return;
    }

    reconciling = true;
    try {
      do {
        pending = false;
        await reconcileProjectSupervisor();
      } while (pending && !stopped);
    } finally {
      reconciling = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();

  activeSupervisor = {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      activeSupervisor = null;
    },
    reconcileNow: run,
  };

  await run();
  return activeSupervisor;
}

export function stopProjectSupervisor(): void {
  activeSupervisor?.stop();
}
