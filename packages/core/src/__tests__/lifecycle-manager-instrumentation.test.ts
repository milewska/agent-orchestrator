/**
 * Tests for activity-event emits added to lifecycle-manager's silent
 * failure paths (scm.review_fetch_failed, scm.poll_pr_failed).
 *
 * Design choices:
 * - vi.mock("../activity-events.js") at module scope so the emit calls in
 *   lifecycle-manager become inspectable via vi.mocked.
 * - Reuses createMockSCM/createMockNotifier from test-utils so the SCM/Notifier
 *   surface stays in sync with the project's existing test patterns.
 * - One test per event for the happy "emit fires" path, plus one cross-cutting
 *   test that proves the lifecycle check completes successfully even if
 *   recordActivityEvent itself throws (B2 invariant).
 *
 * Notifier instrumentation is intentionally omitted — the notifier subsystem
 * is undergoing larger work and AE evidence there is not currently useful.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../activity-events.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../activity-events.js")>();
  return {
    ...original,
    recordActivityEvent: vi.fn(),
  };
});

import { recordActivityEvent } from "../activity-events.js";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { writeMetadata } from "../metadata.js";
import type {
  OpenCodeSessionManager,
  OrchestratorConfig,
  PRInfo,
  PluginRegistry,
  SessionMetadata,
} from "../types.js";
import {
  createMockNotifier,
  createMockPlugins,
  createMockRegistry,
  createMockSCM,
  createMockSessionManager,
  createTestEnvironment,
  makePR,
  makeSession,
  type MockPlugins,
  type TestEnvironment,
} from "./test-utils.js";

let env: TestEnvironment;
let plugins: MockPlugins;
let mockSessionManager: OpenCodeSessionManager;
let config: OrchestratorConfig;

beforeEach(() => {
  env = createTestEnvironment();
  plugins = createMockPlugins();
  mockSessionManager = createMockSessionManager();
  config = env.config;
  vi.mocked(recordActivityEvent).mockClear();
});

afterEach(() => {
  env.cleanup();
});

/** Helper: persist session metadata + register the session with the mock manager. */
function persistSession(
  sessionId: string,
  session: ReturnType<typeof makeSession>,
  metaOverrides: Record<string, unknown> = {},
) {
  const persistedMetadata: Record<string, unknown> = {
    worktree: "/tmp",
    branch: session.branch ?? "main",
    status: session.status,
    project: "my-app",
    runtimeHandle: session.runtimeHandle ?? undefined,
    ...metaOverrides,
  };
  const persistedStringMetadata = Object.fromEntries(
    Object.entries(persistedMetadata).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const enriched = {
    ...session,
    metadata: { ...session.metadata, ...persistedStringMetadata },
  };

  vi.mocked(mockSessionManager.get).mockResolvedValue(enriched);
  vi.mocked(mockSessionManager.list).mockResolvedValue([enriched]);
  writeMetadata(env.sessionsDir, sessionId, persistedMetadata as unknown as SessionMetadata);
  return enriched;
}

function buildLM(registry: PluginRegistry) {
  return createLifecycleManager({ config, registry, sessionManager: mockSessionManager });
}

function makeMatchingPR(overrides: Partial<PRInfo> = {}): PRInfo {
  return makePR({ owner: "org", repo: "my-app", ...overrides });
}

// ---------------------------------------------------------------------------
// scm.review_fetch_failed
// ---------------------------------------------------------------------------

describe("scm.review_fetch_failed", () => {
  it("records an AE event when scm.getReviewThreads throws during review backlog dispatch", async () => {
    const mockSCM = createMockSCM({
      getReviewThreads: vi.fn().mockRejectedValue(new Error("403 forbidden")),
    });
    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: mockSCM,
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "pr_open", pr: makeMatchingPR() });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const reviewFailures = calls.filter((c) => c.kind === "scm.review_fetch_failed");
    expect(reviewFailures).toHaveLength(1);

    const ev = reviewFailures[0]!;
    expect(ev.source).toBe("scm");
    expect(ev.level).toBe("warn");
    expect(ev.summary).toContain("review fetch failed for PR #42");
    expect(ev.projectId).toBe(session.projectId);
    expect(ev.sessionId).toBe(session.id);
    expect(ev.data).toMatchObject({
      prNumber: 42,
      prUrl: "https://github.com/org/my-app/pull/42",
      errorMessage: "403 forbidden",
    });
  });
});

// ---------------------------------------------------------------------------
// scm.poll_pr_failed
// ---------------------------------------------------------------------------

describe("scm.poll_pr_failed", () => {
  it("records an AE event when scm.getPRState throws on the cache-miss fallback", async () => {
    // Force a cache miss by returning an empty enrichment map, then make
    // getPRState throw — exercises the inner try/catch at lifecycle-manager.ts:1053.
    const mockSCM = createMockSCM({
      enrichSessionsPRBatch: vi.fn().mockResolvedValue(new Map()),
      getPRState: vi.fn().mockRejectedValue(new Error("rate limited")),
    });
    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: mockSCM,
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "pr_open", pr: makeMatchingPR() });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const pollFailures = calls.filter((c) => c.kind === "scm.poll_pr_failed");
    expect(pollFailures).toHaveLength(1);

    const ev = pollFailures[0]!;
    expect(ev.source).toBe("scm");
    expect(ev.level).toBe("warn");
    expect(ev.summary).toContain("getPRState failed for PR #42");
    expect(ev.data).toMatchObject({
      prNumber: 42,
      prUrl: "https://github.com/org/my-app/pull/42",
      errorMessage: "rate limited",
    });
  });
});

// ---------------------------------------------------------------------------
// scm.batch_enrich_failed
// ---------------------------------------------------------------------------

describe("scm.batch_enrich_failed", () => {
  it("records an AE event when scm.enrichSessionsPRBatch throws", async () => {
    const mockSCM = createMockSCM({
      enrichSessionsPRBatch: vi.fn().mockRejectedValue(new Error("rate limited")),
    });
    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: mockSCM,
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "pr_open", pr: makeMatchingPR() });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const batchFailures = calls.filter((c) => c.kind === "scm.batch_enrich_failed");
    expect(batchFailures.length).toBeGreaterThan(0);

    const ev = batchFailures[0]!;
    expect(ev.source).toBe("scm");
    expect(ev.level).toBe("warn");
    expect(ev.summary).toContain("batch_enrich failed");
    expect(ev.data).toMatchObject({
      plugin: "github",
      prCount: 1,
      errorMessage: "rate limited",
    });
  });
});

// ---------------------------------------------------------------------------
// scm.detect_pr_succeeded / scm.detect_pr_failed
// ---------------------------------------------------------------------------

describe("scm.detect_pr", () => {
  it("emits scm.detect_pr_succeeded when scm.detectPR finds a PR for a previously-PR-less session", async () => {
    const detectedPR = makeMatchingPR({ number: 99, url: "https://github.com/org/my-app/pull/99" });
    const mockSCM = createMockSCM({
      detectPR: vi.fn().mockResolvedValue(detectedPR),
    });
    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: mockSCM,
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "working" });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const events = calls.filter((c) => c.kind === "scm.detect_pr_succeeded");
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ prNumber: 99 });
  });

  it("emits scm.detect_pr_failed when scm.detectPR throws", async () => {
    const mockSCM = createMockSCM({
      detectPR: vi.fn().mockRejectedValue(new Error("403 forbidden")),
    });
    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: mockSCM,
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "working" });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const events = calls.filter((c) => c.kind === "scm.detect_pr_failed");
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ errorMessage: "403 forbidden" });
  });
});

// ---------------------------------------------------------------------------
// runtime.probe_failed
// ---------------------------------------------------------------------------

describe("runtime.probe_failed", () => {
  it("records an AE event when runtime.isAlive throws", async () => {
    vi.mocked(plugins.runtime.isAlive).mockRejectedValue(new Error("kill -0 EPERM"));

    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: createMockSCM(),
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "working" });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const events = calls.filter((c) => c.kind === "runtime.probe_failed");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.source).toBe("runtime");
    expect(events[0]!.data).toMatchObject({ errorMessage: "kill -0 EPERM" });
  });
});

// ---------------------------------------------------------------------------
// agent.activity_probe_failed
// ---------------------------------------------------------------------------

describe("agent.activity_probe_failed", () => {
  it("records an AE event when the activity probing block throws", async () => {
    vi.mocked(plugins.agent.getActivityState).mockRejectedValue(new Error("native probe died"));

    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: createMockSCM(),
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "working" });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const events = calls.filter((c) => c.kind === "agent.activity_probe_failed");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.source).toBe("agent");
    expect(events[0]!.data).toMatchObject({ errorMessage: "native probe died" });
  });
});

// ---------------------------------------------------------------------------
// agent.process_probe_failed (standalone path)
// ---------------------------------------------------------------------------

describe("agent.process_probe_failed", () => {
  it("records an AE event with where=standalone when isProcessRunning throws on the standalone probe", async () => {
    // Drive activity probe to return null + force standalone path:
    // - getActivityState resolves null → falls into terminal-output fallback
    // - getOutput returns empty → no terminal-fallback isProcessRunning call
    // - then standalone isProcessRunning at line ~1132 fires (processProbe still unknown)
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(null);
    vi.mocked(plugins.runtime.getOutput).mockResolvedValue("");
    vi.mocked(plugins.agent.isProcessRunning).mockRejectedValue(new Error("ps lookup failed"));

    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: createMockSCM(),
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "working" });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    await lm.check("app-1");

    const calls = vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0]);
    const events = calls.filter((c) => c.kind === "agent.process_probe_failed");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.source).toBe("agent");
    expect(events[0]!.data).toMatchObject({
      where: "standalone",
      errorMessage: "ps lookup failed",
    });
  });
});

// ---------------------------------------------------------------------------
// B2 invariant: emits never break the lifecycle flow
// ---------------------------------------------------------------------------

describe("invariant: recordActivityEvent failures do not break the lifecycle flow", () => {
  it("lm.check completes successfully even if recordActivityEvent throws", async () => {
    vi.mocked(recordActivityEvent).mockImplementation(() => {
      throw new Error("AE went boom");
    });

    const registry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      scm: createMockSCM({
        getReviewThreads: vi.fn().mockRejectedValue(new Error("review fetch down")),
      }),
      notifier: createMockNotifier(),
    });

    const session = makeSession({ status: "pr_open", pr: makeMatchingPR() });
    persistSession("app-1", session);

    const lm = buildLM(registry);
    // Per gist + B2: lifecycle code MUST NOT depend on recordActivityEvent
    // success. If this test fails, a new emit was added without the wrapper
    // safety the real recordActivityEvent provides — find the unsafe call site
    // and wrap it (or rely on the real impl's internal try/catch).
    await expect(lm.check("app-1")).resolves.not.toThrow();
  });
});
