/**
 * ReviewStore — flat-file storage for CodeReview runs, findings, and threads.
 *
 * Layout (per project):
 *   {projectBaseDir}/reviews/
 *     runs/{runId}.json                       CodeReviewRun record
 *     findings/{runId}/{findingId}.json       CodeReviewFinding records
 *     threads/{threadId}.json                 CodeReviewThread records
 *
 * The store is AO-local-first: findings live here (not on GitHub) so the human
 * can triage in the Review Workbench and AO can route them to the worker.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeFindingFingerprint } from "./code-review-fingerprint.js";
import type {
  CodeReviewFinding,
  CodeReviewFindingInput,
  CodeReviewFindingStatus,
  CodeReviewLoopState,
  CodeReviewRun,
  CodeReviewRunOutcome,
  CodeReviewTerminationReason,
  CodeReviewThread,
  CodeReviewThreadMessage,
  SessionId,
} from "./types.js";

const RUNS_SUBDIR = "runs";
const FINDINGS_SUBDIR = "findings";
const THREADS_SUBDIR = "threads";

export interface ReviewStore {
  /** Base directory, e.g. "{projectBaseDir}/reviews" */
  readonly baseDir: string;

  // Runs
  createRun(input: CreateRunInput): CodeReviewRun;
  getRun(runId: string): CodeReviewRun | null;
  updateRun(runId: string, patch: Partial<CodeReviewRun>): CodeReviewRun;
  listAllRuns(): CodeReviewRun[];
  listRunsForSession(sessionId: SessionId): CodeReviewRun[];
  deleteRun(runId: string): void;

  // Findings
  appendFinding(runId: string, input: CodeReviewFindingInput): CodeReviewFinding;
  getFinding(runId: string, findingId: string): CodeReviewFinding | null;
  listFindingsForRun(runId: string): CodeReviewFinding[];
  listFindingsForSession(sessionId: SessionId): CodeReviewFinding[];
  updateFindingStatus(
    runId: string,
    findingId: string,
    status: CodeReviewFindingStatus,
    meta?: { dismissedBy?: string; sentToAgentAt?: string },
  ): CodeReviewFinding;

  // Threads
  appendThreadMessage(
    findingId: string,
    runId: string,
    linkedSessionId: SessionId,
    projectId: string,
    message: Omit<CodeReviewThreadMessage, "timestamp"> & { timestamp?: string },
  ): CodeReviewThread;
  getThread(threadId: string): CodeReviewThread | null;
  getThreadForFinding(findingId: string): CodeReviewThread | null;
}

export interface CreateRunInput {
  reviewerSessionId: string;
  reviewerWorkspacePath: string | null;
  linkedSessionId: SessionId;
  projectId: string;
  headSha: string;
  overallSummary?: string;
  loopState?: CodeReviewLoopState;
  outcome?: CodeReviewRunOutcome;
  terminationReason?: CodeReviewTerminationReason;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}

/**
 * Allocate the next reviewer session ID for a project.
 * Format: {sessionPrefix}-rev-{N}
 *
 * IMPORTANT: Scans ALL runs in the project (not per-linked-session) to prevent
 * collisions across multiple workers in the same project.
 */
export function allocateReviewerSessionId(
  existingRuns: CodeReviewRun[],
  sessionPrefix: string,
): string {
  let max = 0;
  const pattern = new RegExp(
    `^${sessionPrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}-rev-(\\d+)$`,
  );
  for (const run of existingRuns) {
    const match = run.reviewerSessionId.match(pattern);
    if (match?.[1]) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `${sessionPrefix}-rev-${max + 1}`;
}

function makeRunId(reviewerSessionId: string, headSha: string): string {
  const shortSha = headSha.slice(0, 7);
  return `${reviewerSessionId}-${shortSha}`;
}

function makeFindingId(runId: string, fingerprint: string): string {
  return `${runId}-${fingerprint}`;
}

function makeThreadId(findingId: string): string {
  return `${findingId}-thread`;
}

export function createReviewStore(projectBaseDir: string): ReviewStore {
  const baseDir = join(projectBaseDir, "reviews");
  const runsDir = (): string => join(baseDir, RUNS_SUBDIR);
  const findingsRunDir = (runId: string): string => join(baseDir, FINDINGS_SUBDIR, runId);
  const threadsDir = (): string => join(baseDir, THREADS_SUBDIR);

  function runPath(runId: string): string {
    return join(runsDir(), `${runId}.json`);
  }
  function findingPath(runId: string, findingId: string): string {
    return join(findingsRunDir(runId), `${findingId}.json`);
  }
  function threadPath(threadId: string): string {
    return join(threadsDir(), `${threadId}.json`);
  }

  function readAllRuns(): CodeReviewRun[] {
    ensureDir(runsDir());
    const files = listJsonFiles(runsDir());
    const runs: CodeReviewRun[] = [];
    for (const file of files) {
      const run = readJsonFile<CodeReviewRun>(join(runsDir(), file));
      if (run) runs.push(run);
    }
    return runs;
  }

  return {
    baseDir,

    createRun(input) {
      ensureDir(runsDir());
      const runId = makeRunId(input.reviewerSessionId, input.headSha);
      const now = new Date().toISOString();
      const run: CodeReviewRun = {
        runId,
        reviewerSessionId: input.reviewerSessionId,
        reviewerWorkspacePath: input.reviewerWorkspacePath,
        linkedSessionId: input.linkedSessionId,
        projectId: input.projectId,
        headSha: input.headSha,
        outcome: input.outcome ?? "completed",
        loopState: input.loopState ?? "reviewing",
        terminationReason: input.terminationReason,
        createdAt: now,
        overallSummary: input.overallSummary ?? "",
        findingCount: 0,
      };
      writeJsonFile(runPath(runId), run);
      return run;
    },

    getRun(runId) {
      return readJsonFile<CodeReviewRun>(runPath(runId));
    },

    updateRun(runId, patch) {
      const existing = readJsonFile<CodeReviewRun>(runPath(runId));
      if (!existing) {
        throw new Error(`Run not found: ${runId}`);
      }
      const updated: CodeReviewRun = { ...existing, ...patch };
      writeJsonFile(runPath(runId), updated);
      return updated;
    },

    listAllRuns() {
      return readAllRuns();
    },

    listRunsForSession(sessionId) {
      return readAllRuns().filter((run) => run.linkedSessionId === sessionId);
    },

    deleteRun(runId) {
      const path = runPath(runId);
      if (existsSync(path)) {
        rmSync(path);
      }
      const runFindingsDir = findingsRunDir(runId);
      if (existsSync(runFindingsDir)) {
        rmSync(runFindingsDir, { recursive: true, force: true });
      }
    },

    appendFinding(runId, input) {
      const run = readJsonFile<CodeReviewRun>(runPath(runId));
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }
      ensureDir(findingsRunDir(runId));
      const fingerprint = computeFindingFingerprint(input);
      const findingId = makeFindingId(runId, fingerprint);
      const finding: CodeReviewFinding = {
        ...input,
        findingId,
        runId,
        linkedSessionId: run.linkedSessionId,
        projectId: run.projectId,
        fingerprint,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      writeJsonFile(findingPath(runId, findingId), finding);

      // Update run's finding count
      writeJsonFile(runPath(runId), { ...run, findingCount: run.findingCount + 1 });

      return finding;
    },

    getFinding(runId, findingId) {
      return readJsonFile<CodeReviewFinding>(findingPath(runId, findingId));
    },

    listFindingsForRun(runId) {
      const dir = findingsRunDir(runId);
      const files = listJsonFiles(dir);
      const findings: CodeReviewFinding[] = [];
      for (const file of files) {
        const f = readJsonFile<CodeReviewFinding>(join(dir, file));
        if (f) findings.push(f);
      }
      return findings;
    },

    listFindingsForSession(sessionId) {
      const runs = readAllRuns().filter((r) => r.linkedSessionId === sessionId);
      const findings: CodeReviewFinding[] = [];
      for (const run of runs) {
        findings.push(...this.listFindingsForRun(run.runId));
      }
      return findings;
    },

    updateFindingStatus(runId, findingId, status, meta) {
      const existing = readJsonFile<CodeReviewFinding>(findingPath(runId, findingId));
      if (!existing) {
        throw new Error(`Finding not found: ${runId}/${findingId}`);
      }
      const now = new Date().toISOString();
      const updated: CodeReviewFinding = {
        ...existing,
        status,
        dismissedBy:
          status === "dismissed"
            ? meta?.dismissedBy ?? existing.dismissedBy
            : existing.dismissedBy,
        dismissedAt: status === "dismissed" ? now : existing.dismissedAt,
        sentToAgentAt:
          status === "sent_to_agent" ? meta?.sentToAgentAt ?? now : existing.sentToAgentAt,
      };
      writeJsonFile(findingPath(runId, findingId), updated);
      return updated;
    },

    appendThreadMessage(findingId, runId, linkedSessionId, projectId, message) {
      ensureDir(threadsDir());
      const threadId = makeThreadId(findingId);
      const existing = readJsonFile<CodeReviewThread>(threadPath(threadId));
      const now = message.timestamp ?? new Date().toISOString();
      const fullMessage: CodeReviewThreadMessage = {
        role: message.role,
        content: message.content,
        timestamp: now,
        author: message.author,
      };

      if (existing) {
        const updated: CodeReviewThread = {
          ...existing,
          messages: [...existing.messages, fullMessage],
          updatedAt: now,
        };
        writeJsonFile(threadPath(threadId), updated);
        return updated;
      }

      const thread: CodeReviewThread = {
        threadId,
        findingId,
        runId,
        linkedSessionId,
        projectId,
        messages: [fullMessage],
        createdAt: now,
        updatedAt: now,
      };
      writeJsonFile(threadPath(threadId), thread);
      return thread;
    },

    getThread(threadId) {
      return readJsonFile<CodeReviewThread>(threadPath(threadId));
    },

    getThreadForFinding(findingId) {
      return readJsonFile<CodeReviewThread>(threadPath(makeThreadId(findingId)));
    },
  };
}

// Re-export from fingerprint module so callers can `import { computeFindingFingerprint } from "./review-store.js"`.
export { computeFindingFingerprint } from "./code-review-fingerprint.js";
