/**
 * Code review finding fingerprint + convergence helpers.
 *
 * Fingerprints give us stable identity for findings across review runs. When a
 * human dismisses a finding, we want the same issue to stay dismissed on the
 * next run even though line numbers may have shifted. The fingerprint relies on
 * structural anchors (file + category + severity + enclosing scope) rather than
 * text snippets so small refactors don't invalidate triage state.
 *
 * Convergence helpers detect the "stalled" state via a sliding-window union of
 * open finding fingerprints. This catches flip-flop loops that a pairwise
 * superset check would miss.
 */

import { createHash } from "node:crypto";
import type { CodeReviewFinding, CodeReviewFindingInput } from "./types.js";

/** Truncated sha256 of the fingerprint components, 16 hex chars. */
export function computeFindingFingerprint(
  finding: Pick<
    CodeReviewFindingInput,
    "filePath" | "category" | "severity" | "anchorSignature" | "startLine" | "endLine"
  >,
): string {
  const anchor =
    finding.anchorSignature && finding.anchorSignature.length > 0
      ? finding.anchorSignature
      : `L${finding.startLine}-${finding.endLine}`;
  const payload = [finding.filePath, finding.category, finding.severity, anchor].join("\0");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Sliding-window union of open finding fingerprints across recent runs.
 * Each run's findings array is filtered to non-dismissed findings before union.
 */
export function slidingWindowUnion(
  runFindings: ReadonlyArray<ReadonlyArray<CodeReviewFinding>>,
  windowSize: number,
): Set<string> {
  const start = Math.max(0, runFindings.length - windowSize);
  const union = new Set<string>();
  for (let i = start; i < runFindings.length; i++) {
    const findings = runFindings[i];
    if (!findings) continue;
    for (const f of findings) {
      if (f.status === "dismissed") continue;
      union.add(f.fingerprint);
    }
  }
  return union;
}

/**
 * Convergence verdict given a history of run findings.
 * Returns "stalled" when the sliding-window union failed to shrink over the
 * last `maxReviewRounds` runs; "converging" otherwise.
 */
export function detectStalled(
  runFindings: ReadonlyArray<ReadonlyArray<CodeReviewFinding>>,
  maxReviewRounds: number,
  stallWindow: number,
): "stalled" | "converging" {
  if (runFindings.length < maxReviewRounds) return "converging";
  const current = slidingWindowUnion(runFindings, stallWindow);
  if (current.size === 0) return "converging";
  const prior = slidingWindowUnion(runFindings.slice(0, -1), stallWindow);
  if (prior.size === 0) return "converging";
  return current.size >= prior.size ? "stalled" : "converging";
}

/**
 * For a newly produced set of finding inputs, carry forward triage state from
 * prior stored findings with matching fingerprints. Dismissed findings remain
 * dismissed; sent_to_agent becomes open again (fresh occurrence worth re-surfacing
 * if the worker did not fix).
 */
export interface CarryForwardResult {
  status: CodeReviewFinding["status"];
  dismissedBy?: string;
  dismissedAt?: string;
}

export function carryForwardTriage(prior: CodeReviewFinding | undefined): CarryForwardResult {
  if (!prior) return { status: "open" };
  if (prior.status === "dismissed") {
    return {
      status: "dismissed",
      dismissedBy: prior.dismissedBy,
      dismissedAt: prior.dismissedAt,
    };
  }
  return { status: "open" };
}
