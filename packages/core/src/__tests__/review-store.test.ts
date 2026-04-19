/**
 * Unit tests for ReviewStore + fingerprint + convergence helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocateReviewerSessionId,
  computeFindingFingerprint,
  createReviewStore,
  type ReviewStore,
} from "../review-store.js";
import {
  carryForwardTriage,
  detectStalled,
  slidingWindowUnion,
} from "../code-review-fingerprint.js";
import type { CodeReviewFinding, CodeReviewRun } from "../types.js";

describe("computeFindingFingerprint", () => {
  it("is stable for identical inputs", () => {
    const fp1 = computeFindingFingerprint({
      filePath: "src/foo.ts",
      category: "bug",
      severity: "error",
      anchorSignature: "function foo() {",
      startLine: 1,
      endLine: 3,
    });
    const fp2 = computeFindingFingerprint({
      filePath: "src/foo.ts",
      category: "bug",
      severity: "error",
      anchorSignature: "function foo() {",
      startLine: 1,
      endLine: 3,
    });
    expect(fp1).toBe(fp2);
  });

  it("differs when any component changes", () => {
    const base = {
      filePath: "src/foo.ts",
      category: "bug" as const,
      severity: "error" as const,
      anchorSignature: "function foo() {",
      startLine: 1,
      endLine: 3,
    };
    const fp = computeFindingFingerprint(base);
    expect(fp).not.toBe(computeFindingFingerprint({ ...base, filePath: "src/bar.ts" }));
    expect(fp).not.toBe(computeFindingFingerprint({ ...base, category: "perf" }));
    expect(fp).not.toBe(computeFindingFingerprint({ ...base, severity: "warning" }));
    expect(fp).not.toBe(computeFindingFingerprint({ ...base, anchorSignature: "other" }));
  });

  it("produces a 16-char hex string", () => {
    const fp = computeFindingFingerprint({
      filePath: "a",
      category: "b",
      severity: "info",
      anchorSignature: "c",
      startLine: 1,
      endLine: 1,
    });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("falls back to line range when anchor is absent", () => {
    const fp1 = computeFindingFingerprint({
      filePath: "a",
      category: "b",
      severity: "info",
      startLine: 10,
      endLine: 20,
    });
    const fp2 = computeFindingFingerprint({
      filePath: "a",
      category: "b",
      severity: "info",
      startLine: 11,
      endLine: 20,
    });
    expect(fp1).not.toBe(fp2);
  });
});

describe("allocateReviewerSessionId", () => {
  it("starts at 1 when no existing reviewers", () => {
    expect(allocateReviewerSessionId([], "ao")).toBe("ao-rev-1");
  });

  it("increments past the max existing number across the whole project", () => {
    const runs: CodeReviewRun[] = [
      { reviewerSessionId: "ao-rev-1" } as CodeReviewRun,
      { reviewerSessionId: "ao-rev-5" } as CodeReviewRun,
      { reviewerSessionId: "ao-rev-3" } as CodeReviewRun,
    ];
    expect(allocateReviewerSessionId(runs, "ao")).toBe("ao-rev-6");
  });

  it("ignores IDs from other prefixes", () => {
    const runs: CodeReviewRun[] = [
      { reviewerSessionId: "other-rev-10" } as CodeReviewRun,
    ];
    expect(allocateReviewerSessionId(runs, "ao")).toBe("ao-rev-1");
  });
});

describe("ReviewStore", () => {
  let tempDir: string;
  let store: ReviewStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ao-review-store-"));
    store = createReviewStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates and retrieves runs", () => {
    const run = store.createRun({
      reviewerSessionId: "ao-rev-1",
      reviewerWorkspacePath: "/tmp/ws",
      linkedSessionId: "ao-1",
      projectId: "demo",
      headSha: "abc1234",
      overallSummary: "",
    });
    const fetched = store.getRun(run.runId);
    expect(fetched?.runId).toBe(run.runId);
    expect(fetched?.loopState).toBe("reviewing");
    expect(fetched?.outcome).toBe("completed");
  });

  it("lists runs for a specific session", () => {
    store.createRun({
      reviewerSessionId: "ao-rev-1",
      reviewerWorkspacePath: null,
      linkedSessionId: "ao-1",
      projectId: "demo",
      headSha: "sha-a",
    });
    store.createRun({
      reviewerSessionId: "ao-rev-2",
      reviewerWorkspacePath: null,
      linkedSessionId: "ao-2",
      projectId: "demo",
      headSha: "sha-b",
    });
    const forOne = store.listRunsForSession("ao-1");
    expect(forOne.length).toBe(1);
    expect(forOne[0]?.headSha).toBe("sha-a");
  });

  it("appends findings and updates status", () => {
    const run = store.createRun({
      reviewerSessionId: "ao-rev-1",
      reviewerWorkspacePath: null,
      linkedSessionId: "ao-1",
      projectId: "demo",
      headSha: "sha-a",
    });
    const finding = store.appendFinding(run.runId, {
      filePath: "src/a.ts",
      startLine: 1,
      endLine: 2,
      title: "t",
      description: "d",
      category: "bug",
      severity: "error",
      confidence: 0.9,
    });
    expect(finding.status).toBe("open");

    const dismissed = store.updateFindingStatus(run.runId, finding.findingId, "dismissed", {
      dismissedBy: "operator",
    });
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedBy).toBe("operator");
    expect(dismissed.dismissedAt).toBeTypeOf("string");
  });

  it("appends thread messages per finding", () => {
    const run = store.createRun({
      reviewerSessionId: "ao-rev-1",
      reviewerWorkspacePath: null,
      linkedSessionId: "ao-1",
      projectId: "demo",
      headSha: "sha-a",
    });
    const finding = store.appendFinding(run.runId, {
      filePath: "src/a.ts",
      startLine: 1,
      endLine: 1,
      title: "t",
      description: "d",
      category: "bug",
      severity: "error",
      confidence: 0.9,
    });
    const thread = store.appendThreadMessage(finding.findingId, run.runId, "ao-1", "demo", {
      role: "human",
      content: "This is intentional backwards compat.",
    });
    expect(thread.messages.length).toBe(1);

    const thread2 = store.appendThreadMessage(finding.findingId, run.runId, "ao-1", "demo", {
      role: "reviewer",
      content: "Acknowledged.",
    });
    expect(thread2.messages.length).toBe(2);
  });
});

describe("carryForwardTriage", () => {
  it("returns open when there is no prior finding", () => {
    expect(carryForwardTriage(undefined).status).toBe("open");
  });

  it("preserves dismissed state with metadata", () => {
    const prior = {
      status: "dismissed",
      dismissedBy: "operator",
      dismissedAt: "2026-01-01T00:00:00Z",
    } as unknown as CodeReviewFinding;
    const result = carryForwardTriage(prior);
    expect(result.status).toBe("dismissed");
    expect(result.dismissedBy).toBe("operator");
    expect(result.dismissedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("re-opens findings that were previously sent_to_agent", () => {
    const prior = { status: "sent_to_agent" } as unknown as CodeReviewFinding;
    expect(carryForwardTriage(prior).status).toBe("open");
  });
});

describe("slidingWindowUnion", () => {
  function f(fp: string, status: CodeReviewFinding["status"] = "open"): CodeReviewFinding {
    return { fingerprint: fp, status } as CodeReviewFinding;
  }

  it("unions fingerprints across the window, excluding dismissed", () => {
    const u = slidingWindowUnion(
      [[f("a"), f("b", "dismissed")], [f("c")], [f("a"), f("d")]],
      3,
    );
    expect([...u].sort()).toEqual(["a", "c", "d"]);
  });

  it("respects the window size", () => {
    const u = slidingWindowUnion([[f("a")], [f("b")], [f("c")]], 2);
    expect([...u].sort()).toEqual(["b", "c"]);
  });
});

describe("detectStalled", () => {
  function f(fp: string, status: CodeReviewFinding["status"] = "open"): CodeReviewFinding {
    return { fingerprint: fp, status } as CodeReviewFinding;
  }

  it("returns converging before hitting maxReviewRounds", () => {
    expect(detectStalled([[f("a")], [f("a")]], 3, 3)).toBe("converging");
  });

  it("catches flip-flop loops via window union", () => {
    // run sequence: {a} -> {b} -> {a}
    // pairwise superset check would miss this; window union is {a,b} stable.
    const verdict = detectStalled([[f("a")], [f("b")], [f("a")]], 3, 3);
    expect(verdict).toBe("stalled");
  });

  it("treats progress as converging (window=1)", () => {
    // Latest finding set shrinks relative to prior — window=1 models pure progress.
    const verdict = detectStalled(
      [[f("a"), f("b")], [f("a"), f("b")], [f("c")]],
      3,
      1,
    );
    expect(verdict).toBe("converging");
  });

  it("treats an empty current window as converging", () => {
    expect(detectStalled([[f("a")], [f("b")], []], 3, 1)).toBe("converging");
  });
});
