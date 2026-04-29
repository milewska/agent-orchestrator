# SCM Interface Redesign: Making AO Provider-Agnostic

## Problem

The SCM interface in `types.ts` is already the single contract between AO and any SCM provider. But AO reaches around the interface in places — the lifecycle manager orchestrates provider-specific optimization details, the CLI hard-checks plugin names, and the web hardcodes GitHub URLs.

### Where provider knowledge leaks outside the plugins

| Area | What leaks |
|------|------------|
| **Lifecycle manager** | `enrichSessionsPRBatch`, `prListUnchangedRepos`, Guard 1 ETag gating, `graphql_batch` metrics — all shaped around GitHub's batch strategy |
| **CLI spawn** | `project.scm.plugin === "github"` for auth preflight |
| **CLI start** | `host === "github.com"` for clone strategy |
| **Web** | `buildGitHubCompareUrl()` / `buildGitHubBranchUrl()` hardcode `github.com` |

### What the lifecycle manager does today

The lifecycle manager owns ~200 lines of SCM orchestration:

1. **`populatePREnrichmentCache()`** (~120 lines) — groups sessions by plugin, calls `enrichSessionsPRBatch()` (optional, only GitHub has it), manages `prEnrichmentCache` Map, manages `prListUnchangedRepos` (Guard 1 concept leaked into core), logs `graphql_batch` metrics, gates `detectPR()` based on Guard 1.

2. **`determineStatus()`** — reads from `prEnrichmentCache`, falls back to individual `getPRState()` for cache misses (merged/closed only).

3. **`maybeDispatchReviewBacklog()`** (~100 lines) — owns 2-minute throttle, checks if `scm.getReviewThreads` exists and falls back to `getPendingComments`, splits threads by `isBot`, manages fingerprint tracking, persists to metadata for dashboard.

4. **`maybeDispatchMergeConflicts()`** — reads `hasConflicts` from `prEnrichmentCache`.

The lifecycle manager knows that some plugins can batch and some can't, knows about ETag guards, manages caches shaped around GitHub's strategy, handles `getReviewThreads` vs `getPendingComments` fallback, and throttles review calls.

---

## Core insight

The main thing AO does with SCM is: **poll the remote, detect changes in session PRs, update session states accordingly.**

Every SCM method exists to answer one of these questions per session per poll cycle:

```
1. Does this session have a PR yet?          -> detectPR()
2. What state is the PR in?                  -> getPRState() / getPRSummary()
3. Is CI passing?                            -> getCIChecks() / getCISummary()
4. What do reviewers say?                    -> getReviewDecision() / getReviewThreads()
5. Can we merge?                             -> getMergeability()
6. Are there new comments to act on?         -> getPendingComments() / getReviewThreads()
7. Are there merge conflicts?                -> getMergeability().hasConflicts
```

All of these are "tell me the current remote state." The lifecycle manager shouldn't orchestrate how that data is fetched — it should just receive the answers.

---

## Solution

The SCM interface in `types.ts` is already the gateway. We don't need a new layer. We need to:

1. **Consolidate the polling into one `poll()` method** — so the lifecycle manager stops orchestrating internals.
2. **Remove every SCM-provider-specific reference outside the plugins.**

### Proposed interface

```typescript
interface SCM {
  // Replaces: enrichSessionsPRBatch + detectPR + getPRState + getCISummary +
  //           getReviewDecision + getMergeability + getReviewThreads + getPendingComments
  poll(sessions: Session[], project: ProjectConfig): Promise<Map<string, SessionPRState>>

  // Mutations — stay as-is
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>
  closePR(pr: PRInfo): Promise<void>

  // Operations — stay as-is
  resolvePR(reference: string, project: ProjectConfig): Promise<PRInfo | null>
  checkoutPR(pr: PRInfo, workspacePath: string): Promise<boolean>
  assignPRToCurrentUser?(pr: PRInfo): Promise<void>

  // Auth — new, replaces hardcoded plugin name checks
  checkAuth?(): Promise<void>
}
```

### Return shape from `poll()`

One unified shape per session:

```typescript
interface SessionPRState {
  prDetected: PRInfo | null
  prState: "open" | "merged" | "closed" | null
  ciStatus: "passing" | "failing" | "pending" | "none"
  ciChecks: CICheck[]
  reviewDecision: "approved" | "changes_requested" | "pending" | "none"
  mergeability: {
    mergeable: boolean
    ciPassing: boolean
    approved: boolean
    noConflicts: boolean
    blockers: string[]
  }
  reviewThreads: { threads: ReviewComment[], reviews: ReviewSummary[] } | null
  hasConflicts: boolean
  isDraft: boolean
  title: string
  additions: number
  deletions: number
}
```

### What moves where

**Moves INTO the plugin's `poll()` implementation:**

| Concern | Currently in lifecycle manager | After: inside plugin |
|---------|-------------------------------|---------------------|
| Batch enrichment orchestration | `populatePREnrichmentCache()` ~120 lines | GitHub plugin uses GraphQL batching internally |
| PR enrichment cache | `prEnrichmentCache` Map in lifecycle manager | Plugin manages its own cache |
| ETag guard gating | `prListUnchangedRepos` / Guard 1 skip logic | GitHub plugin's internal optimization |
| Review throttling | 2-min throttle in `maybeDispatchReviewBacklog()` | Plugin decides when to refresh reviews |
| `getReviewThreads` vs `getPendingComments` fallback | Lifecycle manager checks if method exists | Plugin returns review threads however it can |
| `graphql_batch` metrics | Logged from lifecycle manager | Plugin logs its own metrics |

**Stays in AO (provider-agnostic):**

| Concern | Where |
|---------|-------|
| Call `scm.poll()` and read results | Lifecycle manager |
| State transitions based on poll results | `lifecycle-status-decisions.ts` |
| Review fingerprint tracking + dispatch | Lifecycle manager (reads from poll result) |
| Merge conflict dispatch | Lifecycle manager (reads from poll result) |
| `scm.mergePR()` / `scm.closePR()` | Session manager, web merge API |
| `scm.resolvePR()` / `scm.checkoutPR()` | Session manager `claimPR()` |
| `scm.checkAuth()` | CLI spawn preflight |

---

## Before and after

### How the system behaves now

```
Lifecycle Manager (owns the choreography)
|
|  "I know that some plugins can batch, some can report
|   unchanged repos, some have getReviewThreads and some
|   don't. I orchestrate all of it."
|
+-- populatePREnrichmentCache()           <- 120 lines
|   +-- group sessions by plugin
|   +-- call enrichSessionsPRBatch()      <- optional, only GitHub has it
|   +-- manage prEnrichmentCache          <- lifecycle manager owns this Map
|   +-- manage prListUnchangedRepos       <- Guard 1 concept leaked into core
|   +-- log graphql_batch metrics         <- GitHub implementation detail in core
|   +-- for sessions without PR:
|       +-- check prListUnchangedRepos    <- skip if Guard 1 said no change
|       +-- call detectPR()
|
+-- determineStatus()
|   +-- check prEnrichmentCache           <- read from the Map above
|   +-- if cache miss:
|   |   +-- call getPRState()             <- fallback, only for merged/closed
|   +-- pass to resolvePREnrichmentDecision()
|
+-- maybeDispatchReviewBacklog()          <- 100+ lines
|   +-- 2-min throttle (lifecycle owns this)
|   +-- if scm.getReviewThreads exists:
|   |   +-- call getReviewThreads()
|   +-- else:
|   |   +-- call getPendingComments()     <- fallback
|   +-- split by isBot
|   +-- fingerprint tracking
|   +-- persist to metadata for dashboard
|
+-- maybeDispatchMergeConflicts()
|   +-- read hasConflicts from prEnrichmentCache
|
CLI status
|  +-- calls detectPR(), getCISummary(), getReviewDecision(),
|     getPendingComments() fresh every time (4 API calls per session)
|
CLI spawn
|  +-- if (project.scm.plugin === "github") checkGhAuth()
|
Web
|  +-- buildGitHubCompareUrl() -> hardcoded "https://github.com"
|  +-- merge API -> getPRState() + getMergeability() + mergePR()
```

### How the system should behave

```
Lifecycle Manager (knows nothing about SCM internals)
|
|  "I call poll(). I get states. I react."
|
+-- const states = await scm.poll(sessions, project)
|   |
|   |  returns Map<sessionId, {
|   |    prDetected, prState, ciStatus, ciChecks,
|   |    reviewDecision, mergeability, reviewThreads,
|   |    hasConflicts, isDraft, title, additions, deletions
|   |  }>
|   |
|   +-- lifecycle manager just reads the map and transitions states.
|      no cache management. no throttling. no fallbacks. no guards.
|
+-- determineStatus()
|   +-- read from poll() result -> resolvePREnrichmentDecision()
|
+-- maybeDispatchReviewBacklog()
|   +-- read reviewThreads from poll() result (already fetched, already split)
|
+-- maybeDispatchMergeConflicts()
|   +-- read hasConflicts from poll() result
|
CLI status
|  +-- read last poll() result from metadata. zero API calls. instant.
|
CLI spawn
|  +-- await scm.checkAuth()   <- plugin validates its own CLI auth
|
Web
|  +-- buildBranchUrl(pr)      <- derives from pr.url origin, no hardcoded host
|  +-- merge API -> scm.mergePR()


Inside GitHub plugin (all GitHub knowledge lives here):
|
+-- poll(sessions, project)
    +-- Guard 1: ETag check on PR list
    +-- Guard 2: ETag check on commit status
    +-- GraphQL batch for changed PRs
    +-- detectPR for sessions without PR (skipped if Guard 1 says no change)
    +-- getReviewThreads (with internal throttle)
    +-- cache management (TTL, LRU, positive-only detectPR)
    +-- return unified Map


Inside GitLab plugin (all GitLab knowledge lives here):
|
+-- poll(sessions, project)
    +-- glab api for each session's MR state
    +-- glab api for pipelines
    +-- glab api for approvals + discussions
    +-- internal caching (whatever makes sense for GitLab)
    +-- return unified Map
```

---

## Comparison

| | Now | After |
|---|---|---|
| **Lifecycle manager SCM code** | ~200 lines orchestrating 5+ methods, managing caches, throttling, fallbacks | ~5 lines: call `poll()`, read results |
| **Lifecycle manager knows about** | batch vs non-batch plugins, ETag guards, review thread fallback, cache maps, throttle intervals | nothing — it gets a Map |
| **Adding a new SCM plugin requires** | implementing 15+ methods, hoping the lifecycle manager's orchestration works for your plugin | implementing `poll()` + mutations |
| **GitHub optimizations live in** | split between GitHub plugin (ETags, GraphQL) and lifecycle manager (cache, guard gating, throttle) | entirely inside GitHub plugin |
| **CLI auth check** | `if (plugin === "github")` | `scm.checkAuth()` |
| **Web URLs** | hardcoded `github.com` | derived from `pr.url` |
| **Provider names in core/cli/web** | yes, scattered | zero |

---

## Hardcoded spots to fix

| What | Where | Fix |
|------|-------|-----|
| `plugin === "github"` auth check | `cli/src/commands/spawn.ts:101` | Add `checkAuth()` to SCM interface. Each plugin validates its own CLI auth. |
| `host === "github.com"` clone | `cli/src/commands/start.ts:459` | Detect CLI availability generically or add `cloneRepo()` to the interface. |
| `buildGitHubCompareUrl()` | `web/src/lib/github-links.ts` | Derive URL from `pr.url` origin instead of hardcoding `github.com`. |
| `buildGitHubBranchUrl()` | `web/src/components/session-detail-utils.ts:54` | Same — derive from `pr.url` origin. Already partially does this. |

---

## Webhook note

The SCM interface also has `verifyWebhook()` and `parseWebhook()`. These are plumbed in the web webhook API route (`web/src/app/api/webhooks/[...slug]/route.ts`) but never actually used — AO runs locally and GitHub/GitLab can't POST to localhost. These can remain on the interface for future use but are not part of the core redesign.

---

## Non-goals

- No new "gateway" layer or middleware. The SCM interface itself is the abstraction boundary.
- No changes to the session lifecycle state machine or status decisions.
- No changes to how mutations (`mergePR`, `closePR`) work.
- No changes to the `claimPR` flow (just remove the hardcoded auth check).
