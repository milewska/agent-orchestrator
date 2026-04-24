# GitHub API Rate Limiting — Complete Change Log (PR #1238)

## The Problem

**AO was burning through GitHub's API rate limits too fast, making it impossible to run many concurrent sessions.**

GitHub gives you **5,000 REST requests/hr** and **5,000 GraphQL points/hr** per PAT. The goal was to support **50+ concurrent sessions on a single GitHub token**.

### Root Causes Found

1. **The ETag guard was completely broken (silent no-op).** AO had code intended to skip the full GraphQL batch when nothing had changed (using HTTP 304 Not Modified). But `gh api -i` exits with code 1 on a 304, and the catch block was treating that as "something changed" — triggering a full GraphQL batch call every single poll cycle regardless. The optimization was doing the opposite of its intent.

2. **Agents themselves were the bigger consumer.** When we ran 5 real Claude Code agents, they exhausted the GraphQL bucket in 31 minutes at ~9,572 pts/hr — 37× more than AO's own polling. AO consumed only ~10 calls; agents were calling `gh` constantly through the `~/.ao/bin/gh` wrapper, which had no visibility or caching.

3. **Two independent polling loops.** The CLI lifecycle manager and the web dashboard were each running their own independent GitHub API polling loops, doubling all traffic. The dashboard was also making individual REST calls for each session's PR data on top of that.

### The hard numbers (before)

Before we started, extrapolation from 5-session runs showed:

| Sessions | GraphQL burn/hr | Status |
|---------:|----------------:|--------|
| 5 | 683–1,180 | Safe |
| 20 | 2,733–4,720 | At the edge |
| 50 | 6,833–11,800 | **Over budget** |

Practical ceiling with the bugs in place: **~20–35 sessions max**.

### The hard numbers (after) — 15-session benchmark

| Metric | Before (projected) | After (actual) | Reduction |
|--------|-------------------|----------------|-----------|
| Total calls (22.6 min) | ~1,724 | 132 | **−92%** |
| Calls/min | 76.3 | 5.6 | **−93%** |
| GraphQL pts/hr | ~6,216 | ~96 | **−98%** |
| REST calls (22.6 min) | ~1,423 | 122 | **−91%** |
| GraphQL calls (22.6 min) | ~301 | 10 | **−97%** |
| Dashboard API calls | ~150/15 min | 0 | **−100%** |
| Per session GraphQL | ~414 pts/hr | ~6.4 pts/hr | **−98%** |
| Max sessions before exhaustion | ~12 | ~50 | **+317%** |
| Lifecycle managers | 2 | 1 | removed duplication |
| Budget status (15 sessions) | **Over budget at 48 min** | ~2% used | — |

### Current poll architecture (15 sessions, 22.6 min trace)

```
pollAll()
  │
  ├── Phase 1: populatePREnrichmentCache()        ← ONCE for all sessions
  │     ├── ETag Guard 1 (per repo)                  20 calls (14×304, 6×200)
  │     ├── ETag Guard 2 (per PR)                     0 calls (Guard 1 covered it)
  │     ├── GraphQL Batch Query                       3 calls (~36 GraphQL pts)
  │     └── detectPR (only on Guard 1 200)           66 calls (6 cycles × ~11 PR-less sessions)
  │
  ├── Phase 2: checkSession() × N                 ← per session
  │     └── determineStatus()
  │           ├── PR Auto-Detect                      0 calls (moved to Phase 1)
  │           └── Fallback Individual Calls           0 calls (removed)
  │
  ├── Phase 3: maybeDispatchReviewBacklog() × N   ← per session (throttled 2min)
  │     ├── Guard 3 (review comments ETag)            1 call (0×304, 1×200)
  │     └── GraphQL review threads + reviews          1 call (~2 GraphQL pts)
  │
  ├── Phase 4: maybeDispatchCIFailureDetails()        0 calls (batch has checks)
  │
  └── Phase 5: maybeDispatchMergeConflicts()          0 calls (batch has data)

  Issue view (tracker, 5-min TTL + dedup):           35 calls (2.3 per issue)

  Total: 126 calls | 5.6 calls/min | ~96 GraphQL pts/hr
```

---

## Summary

AO was hitting GitHub's 5,000 pts/hr GraphQL limit at just ~12 concurrent sessions, making 50-session support impossible. The core bug was a broken ETag guard — `gh api -i` exits code 1 on HTTP 304, so the catch block assumed "changed" and fired a full GraphQL batch every poll cycle, making the optimization completely dead. On the AO side, we added in-process per-method TTL caches across `scm-github` and `tracker-github`, removed individual REST fallbacks from lifecycle polling, consolidated review comment fetching into a single GraphQL call, and removed an unused `reviews` field from every batch query. The biggest structural fix was shared enrichment — the CLI lifecycle manager now persists batch results to session metadata files, and the web dashboard reads from disk instead of making its own GitHub API calls, eliminating the duplicate polling loop entirely. Final result: GraphQL down from ~2,072 to ~604 pts/hr (−56%), max supported sessions up from ~12 to ~41 (+242%), and dashboard API calls reduced to zero. Notably, a significant chunk of API consumption still comes from agents calling `gh` directly — this is currently uncontrolled since LLMs are non-deterministic. A promising next step would be modifying the agent prompt to instruct agents to use already-fetched PR/issue data passed in context rather than re-querying GitHub themselves.

---

## Major Steps

1. **Instrumented AO with `execGhObserved()`** — added JSONL tracing to all GitHub CLI calls to get baseline visibility on what was being called and how often.

2. **Fixed the broken ETag guard** — `gh api -i` exits code 1 on HTTP 304; the catch block was treating this as "changed" and firing a full GraphQL batch every poll cycle. Fixed by detecting 304 in the error output before treating it as a real failure.

3. **Added in-process caches to `scm-github`** — per-method TTLs (5s–60s) on all PR-related calls (`detectPR`, `resolvePR`, `getPRState`, `getCIChecks`, `getMergeability`, `getReviews`, `getReviewDecision`, `getPendingComments`).

4. **Added in-process cache to `tracker-github`** — 5-min TTL on issue reads with inflight dedup (concurrent requests share one API call).

5. **Removed individual REST fallbacks from lifecycle polling** — `determineStatus()`, `maybeDispatchCIFailureDetails()`, `maybeDispatchMergeConflicts()` no longer fall back to individual `gh pr view` / `gh pr checks` calls on batch miss.

6. **Consolidated review comment fetching** — replaced the paginated REST `getAutomatedComments()` call with a single GraphQL `getReviewThreads()` call.

7. **Removed unused `reviews(last: 5)` from the batch query** — it was being fetched on every batch call but never consumed.

8. **Shared enrichment + single lifecycle manager** — CLI lifecycle manager persists batch enrichment to session metadata files; web dashboard reads from disk instead of calling GitHub. Eliminated the duplicate web polling loop entirely, reducing lifecycle managers from 2 to 1.

9. **Gated detectPR behind Guard 1 ETag** — moved detectPR out of `determineStatus()` into `populatePREnrichmentCache()`. Guard 1 runs for all repos every cycle. When 304, detectPR is skipped entirely. When 200, detectPR runs for PR-less sessions only.

10. **Added Guard 3 (review comments ETag)** — REST ETag check on review comments gates the `getReviewThreads` GraphQL call. 304 → skip GraphQL (0 points). 200 → fetch (2 points). ETag-controlled cache replaces TTL cache.

11. **Enriched review data for agents** — `getReviewThreads` now fetches `reviewThreads(last: 100)` + `reviews(last: 5)`. Agent messages include review summaries, thread IDs, and inline comment data. Prompt instructs agents to resolve threads directly and not re-fetch.

---

## Architectural Caches

**1. ETag guards (HTTP 304)**
Three REST ETag guards gate expensive operations:
- **Guard 1** — PR list changes per repo (88% hit rate). Gates the GraphQL batch query AND detectPR for all sessions in that repo.
- **Guard 2** — Commit status changes per PR (85% hit rate). Gates the GraphQL batch when Guard 1 returns 304.
- **Guard 3** — Review comments per PR (~95% hit rate in steady state). Gates the `getReviewThreads` GraphQL call. ETag-controlled cache replaces TTL — cached results reused until Guard 3 detects new comments.

**2. Shared enrichment metadata (disk)**
The lifecycle manager now persists the full batch result (`prEnrichment` + `prReviewComments`) to session metadata files on disk after every poll. The web dashboard reads from these files instead of calling GitHub itself. Why: the dashboard and CLI were running two independent polling loops — both hitting GitHub for the same data. Removing the dashboard's loop and having it read from disk eliminated ~54% of all duplicate traffic and brought dashboard API calls to zero.

**3. `~/.ao/bin/gh` wrapper cache (disk, per-session)**
Every `gh` call agents make goes through this wrapper. It caches `gh pr list --head` with infinite TTL (branch→PR mapping is permanent once created) and `gh issue view` with 300s TTL (agents kept re-fetching the same issue to remind themselves of the task). Why: agent-side `gh` consumption was completely untracked and uncached — 5 real agents exhausted the entire GraphQL bucket in 31 minutes. This was the biggest surprise of the whole investigation.

---

## Cache TTL Reference

### `scm-github` — In-process per-instance cache

Max 1,000 entries. Invalidated on mutations (`mergePR`, `closePR`, `assignPRToCurrentUser`).

| Method | TTL | What's cached | Notes |
|--------|-----|---------------|-------|
| `detectPR` | 30s | Branch → PR mapping | Positive-only. Never caches null (missing PR). |
| `resolvePR` | 60s | PR identity metadata (number, url, title, branch refs, isDraft) | Stable for life of PR. |
| `getPRState` | 5s | open / merged / closed | |
| `getPRSummary` | 5s | state + title + additions/deletions | |
| `getCIChecks` | 5s | CI check list (name, state, link, timestamps) | |
| `getMergeability` | 5s | Composite merge readiness + blockers | |
| `getReviews` | 10s | Review array (state, body, author) | |
| `getReviewDecision` | 10s | approved / changes_requested / pending | |
| `getPendingComments` | 10s | Unresolved review threads (GraphQL) | Backward compat for GitLab. GitHub uses `getReviewThreads` instead. |
| `getReviewThreads` | ETag-controlled | Threads + review summaries | No TTL. Freshness managed by Guard 3 — cached until new comments detected. |

### `tracker-github` — In-process per-instance cache

Max 500 entries. Invalidated on mutations (`updateIssue`). Inflight dedup prevents concurrent duplicate requests.

| Method | TTL | What's cached | Notes |
|--------|-----|---------------|-------|
| `getIssue` | 5 min | Issue metadata (title, body, state, labels, assignees) | `isCompleted` routes through this. Concurrent calls share one request. |

### `~/.ao/bin/gh` wrapper — Agent-side bash cache (disk, per-session)

Stored in `$AO_DATA_DIR/.ghcache/$AO_SESSION/`. Cache key includes `--json` fields.

| Command | TTL | What's cached | Notes |
|---------|-----|---------------|-------|
| `gh pr list --head <branch> --limit 1` | Infinite | Branch → PR JSON | Positive-only. Never caches empty `[]`. |
| `gh issue view <N>` | 300s | Issue JSON response | Any successful response cached. |

---

## Tradeoffs

1. **Cache TTLs vs data freshness** — Tightest TTLs (5s) on fast-changing fields (CI state, mergeability, PR state), looser (10s–30s) on slower-changing ones (reviews, detectPR). Lifecycle could act on data that's a few seconds stale. Accepted because 5s is well under one poll cycle.

2. **Positive-only caching for `detectPR`** — Never cache a null (no PR found). A just-created PR must surface on the next poll, so we pay the `gh` call cost on every miss. Tradeoff: cache is only useful after PR creation, not before.

3. **Batch miss → wait for next cycle** — Removed individual REST fallbacks entirely. If the batch fails, lifecycle waits for the next poll rather than fetching fresh data immediately. In practice the batch query never fails, so this only adds up to 30s latency in the rare failure case while eliminating ~12 individual API calls per poll cycle.

4. **Dashboard reads from disk, not live API** — Dashboard freshness is now tied to the lifecycle poll interval (30s) instead of being real-time. Tradeoff: slightly stale dashboard in exchange for zero GitHub API calls from the web process. If a PR gets merged or CI fails, the dashboard won't reflect it until the next lifecycle poll writes fresh metadata (up to 30s delay).

5. **Reverted PR-scoped ETag guards** — Added per-PR ETag checks instead of per-repo, but this increased REST calls (1 per PR vs 1 per repo) without meaningful GraphQL savings. Reverted when traces showed REST delta went 16→142 while GraphQL stayed flat.

6. **detectPR gated by Guard 1** — detectPR only runs when Guard 1 returns 200. Max 30-second delay in discovering a just-created PR (one poll cycle). Eliminates ~95% of detectPR calls.

7. **Review threads cost doubled (1 → 2 points)** — Adding `reviews(last: 5)` to the query increases cost from 1 to 2 GraphQL points. But Guard 3 skips ~95% of calls, so net cost is lower than before.

---

## Future Scope

1. **Review thread throttle (2 min → 5 min)** — Review threads are currently checked via Guard 3 every 2 minutes per session. Guard 3 makes this much cheaper (0 points on 304), but loosening the throttle would further reduce REST calls.

2. **Persist issue data to session metadata** — Currently fetched via API with 5-min TTL cache. Could write issue data to metadata at spawn time so it's never re-fetched. Would eliminate all `gh issue view` calls after the first.

---

## Detailed Changelog

### Track A — Tracer Infrastructure (Apr 14–16)

1. **Added `execGhObserved()`** — JSONL tracing for all AO-side GitHub CLI calls, writing to `$AO_GH_TRACE_FILE`
2. **Migrated `scm-github` and `tracker-github` call sites** to use `execGhObserved()`
3. **Fixed operation naming** — `extractOperation()` was mis-bucketing REST calls by not skipping dash-prefixed flags
4. **Added `-i` flag to `executeBatchQuery`** — required for ETag/304 response headers
5. **Added per-reset-window burn segmentation** to trace analyzers (`analyze-trace.mjs`, `drill-tracer.mjs`)
6. **Fixed mocked `execFile` path regressions** — guarded stderr/stdout against undefined; bounded operation cardinality by taking only first REST URL path segment

---

### Track B — ETag Guard Bug Fix (Apr 16–17)

7. **Fixed the core ETag 304 bug** — `gh api -i` exits with code 1 on HTTP 304. The catch block was returning `true` (assumed "changed"), firing a full GraphQL batch every poll cycle. Fix: detect 304 in the error's stdout/stderr before treating it as a real error. Unified regex for HTTP/1.1, HTTP/2, HTTP/2.0.
   - Result: 100% ETag 304 hit rate, 0 GraphQL batch calls in steady state, 5% GraphQL budget at 5 sessions

---

### Track C — Agent-Side Consumption (Apr 18–22)

8. **Patched `~/.ao/bin/gh` wrapper with invocation logging** — every `gh` call from agents logged to a JSONL trace
9. **Fixed dash-prefixed args in wrapper logging** — `gh --version` was being mangled
10. **Analyzed agent-side waste** — `gh pr list --head` was 65% of all agent-side wrapper calls; each branch queried 36–75× identically
11. **Added wrapper read-through cache**:
    - `gh pr list --head`: infinite TTL for positive results (598 → ~10 calls, 98% reduction)
    - `gh issue view`: 300s TTL (75 → ~20 calls, 73% reduction)
12. **Lifted PATH wrapper installation into session-manager universally** — removed per-agent-plugin duplication
13. **Added cache-hit/miss tracing to wrapper** — `cacheResult` field: hit/miss-stored/miss-negative/miss-error; added `operation`, `durationMs`, `exitCode`, `ok` fields to trace
14. **Fixed `execGhObserved()` resolving to the wrapper** — it was calling `~/.ao/bin/gh` (the wrapper) instead of the real `gh` binary, causing AO traces to pollute agent traces and cache to silently fail. Fixed by stripping `~/.ao/bin` from PATH at startup
15. **Fixed critical macOS PATH bug** — macOS zsh `path_helper` resets PATH during shell init in tmux sessions, wiping `~/.ao/bin`. The wrapper was never active on macOS. Fix: write `export PATH=...` into a launch script (initial `send-keys` approach sent 1000+ keystrokes and broke terminal input buffers)
16. **Hardened wrapper cache correctness** — cache key now includes `--json` fields; only caches stdout; fixed trailing newline; supports `--key=value` syntax; logs `miss-write-failed`

---

### Track D — AO-Side Cache + Consolidation (Apr 22)

17. **Added in-process per-instance cache to `scm-github`** with per-method TTLs:
    - `resolvePR`: 60s
    - `getPRState`, `getPRSummary`, `getReviews`, `getReviewDecision`: 5s
    - `getCIChecks`, `getMergeability`, `getPendingComments`: 5s
    - `detectPR`: 5s positive-only
    - Mutation methods invalidate cache
    - Tuned TTLs via cache-replay: `detectPR` 5s→30s, `getReviewDecision` 5s→10s, `getPendingComments` 5s→10s
18. **Added in-process issue cache to `tracker-github`** — `Map<string, CachedIssue>`, 5-min TTL, bounded to 500 entries (LRU evict-oldest). `isCompleted` routed through `getIssue`. ~744 → ~15 `gh issue view` calls per run
19. **Removed individual REST fallbacks from lifecycle polling** — `determineStatus()`, `maybeDispatchCIFailureDetails()`, `maybeDispatchMergeConflicts()` no longer fall back to individual `gh pr view`/`gh pr checks` on batch cache miss. Eliminated ~110 calls per 15-min window (24% of AO-side traffic)
20. **Consolidated review comment fetching into single GraphQL call** — added `getReviewThreads()` to SCM interface. Eliminated `getAutomatedComments()` REST call (~40 calls/15 min)
21. **Removed unused `reviews(last: 5)` from batch query** — it was fetched but never consumed, wasting GraphQL complexity on every batch call
22. **Reverted PR-scoped ETag guards** — per-PR ETag added more REST calls (1 per PR vs 1 per repo) without meaningful GraphQL savings; core REST delta went 16→142 while GraphQL stayed flat

---

### Track E — Shared Enrichment Architecture (Apr 22–23)

23. **CLI lifecycle manager now persists batch enrichment to session metadata** — `prEnrichment` and `prReviewComments` keys written after each poll cycle
24. **Web dashboard reads metadata instead of calling GitHub API** — `serialize.ts` reads enrichment from disk. Dashboard freshness improved from 5 min → 30s (tied to lifecycle poll)
25. **Removed web dashboard's duplicate lifecycle manager** — eliminated the second independent polling loop that was the source of ~54% of remaining duplicate traffic. Dashboard API calls: ~150/15 min → 0
26. **Fixed `storageKey` usage in `persistPREnrichmentToMetadata`** — was using wrong key for `getSessionsDir`

---

### Track F — Gate detectPR behind Guard 1 ETag (Apr 24)

27. **Moved detectPR out of `determineStatus()` into `populatePREnrichmentCache()`** — detectPR now runs once per poll cycle for all PR-less sessions, gated by Guard 1. When Guard 1 returns 304 (no PR list changes in the repo), all detectPR calls are skipped — no new PRs can exist. When Guard 1 returns 200, detectPR runs for PR-less sessions in that repo only.
28. **Added `prListUnchangedRepos` to ETag guard result** — `shouldRefreshPREnrichment()` now tracks which repos returned 304. Reported to the lifecycle manager via `BatchObserver.reportPRListUnchangedRepos()` callback.
29. **Removed detectPR block from `determineStatus()`** — PR discovery is fully handled in `populatePREnrichmentCache` before session checks run. No flags, no fallback.
   - Impact: 10 sessions with no PRs for 10 minutes → ~200 wasted calls reduced to ~10 (only on 200 cycles). ~95% reduction in detectPR calls.
   - Tradeoff: max 30-second delay (one poll cycle) in discovering a just-created PR.
30. **Guard 1 now always runs for all repos** — `enrichSessionsPRBatch` accepts optional `repos` param. Lifecycle passes repos from all sessions (not just ones with PRs). Guard 1 runs even when no sessions have PRs yet, so detectPR is gated from the very first cycle.
31. **Issue view inflight dedup** — Added promise-based dedup in `tracker-github`. Concurrent calls for the same issue share one request instead of two. Reduced issue view calls from 6 to 3 per 15 min.
32. **Thread ID included in review messages** — `getReviewThreads` and `getPendingComments` now return `threadId` (the GraphQL node ID for `resolveReviewThread`). Agent message includes it so agents can resolve threads directly without re-fetching.
33. **Agent prompt nudge for issue context** — `generatePrompt` now tells the agent "You should not need to call gh issue view unless you need additional context beyond what is provided here."

---

### Track G — Enrich Review Data + Guard 3 (Apr 24)

34. **Added Guard 3 (review comments ETag)** — `checkReviewCommentsETag()` checks `GET /repos/{owner}/{repo}/pulls/{number}/comments?per_page=1` with ETag before the `getReviewThreads` GraphQL call. 304 → skip GraphQL entirely (0 points), 200 → proceed (2 points).
35. **Enriched `getReviewThreads` query** — Changed from `reviewThreads(first: 100)` to `reviewThreads(last: 100)` (most recent threads). Added `reviews(last: 5)` to fetch review submission summaries (the body submitted with "Changes requested" / "Approve"). Cost: 105/100 = 2 GraphQL points (up from 1, but Guard 3 skips ~95% of calls).
36. **Added `ReviewSummary` and `ReviewThreadsResult` types** — `getReviewThreads` now returns `{ threads: ReviewComment[]; reviews: ReviewSummary[] }` instead of just `ReviewComment[]`.
37. **ETag-controlled cache replaces TTL cache** — Review threads + reviews cached per PR instance. Freshness controlled by Guard 3 ETag (not a TTL timer). Cache invalidated only when Guard 3 returns 200 (new comments exist).
38. **Review summaries included in agent message** — When dispatching review feedback, the agent now sees the reviewer's high-level summary prepended before inline comments:
   ```
   Review by @reviewer (CHANGES_REQUESTED):
   "This approach is wrong, use strategy X instead"

   The following 1 unresolved review comment(s)...
   ```
39. **Review summaries persisted to metadata** — `prReviewComments` blob now includes review summaries for dashboard consumption.
