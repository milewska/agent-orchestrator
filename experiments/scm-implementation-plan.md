# SCM Interface Redesign: Implementation Plan

## Context

AO's lifecycle manager currently orchestrates 5+ scattered SCM method calls per poll cycle, managing provider-specific optimization details (ETag guards, GraphQL batching, review throttling) that belong inside the plugins. Additionally, hardcoded GitHub references exist in CLI and web. The goal is to make AO fully provider-agnostic by adding a single `poll()` method to the SCM interface, moving all optimization logic into the plugins, and removing hardcoded provider references.

Design doc: `experiments/scm-interface-redesign.md` on branch `experiment/scm-gateway-design`.

---

## Phase 1: Type definitions

**File: `packages/core/src/types.ts`**

Add after the existing `PREnrichmentData` interface:

```typescript
export interface SessionPollInput {
  sessionId: string;
  session: Session;
  project: ProjectConfig;
}

export interface SessionPollResult {
  /** PR enrichment data. null if session has no PR. */
  enrichment: PREnrichmentData | null;
  /** Detected PR for sessions that didn't have one. null if no new PR found. */
  detectedPR: PRInfo | null;
  /** Review threads. null = plugin throttled this cycle (preserve existing metadata). */
  reviewThreads: ReviewThreadsResult | null;
}

export type SessionPollResults = Map<string, SessionPollResult>;
```

Add to SCM interface (optional methods at the end):

```typescript
poll?(inputs: SessionPollInput[], observer?: BatchObserver): Promise<SessionPollResults>;
checkAuth?(): Promise<void>;
```

Export `SessionPollInput`, `SessionPollResult`, `SessionPollResults` from `packages/core/src/index.ts`.

---

## Phase 2: GitHub plugin `poll()` + `checkAuth()`

**File: `packages/plugins/scm-github/src/index.ts`**

Add inside `createGitHubSCM()` scope:

1. Add `lastReviewPollAt: Map<string, number>` and `REVIEW_POLL_THROTTLE_MS = 2 * 60 * 1000` (same as current lifecycle manager throttle).

2. Add private `pollReviewThreads(session)` helper — checks throttle, calls existing `getReviewThreads(session.pr)`, returns `null` when throttled.

3. Add `poll()` method to the returned SCM object:
   - Collect PRs and repos from `inputs`
   - Call existing `enrichSessionsPRBatchImpl(prs, observer, repos)` — reuse the current batch implementation
   - For sessions without PR: call existing `detectPR()` gated by `batchResult.prListUnchangedRepos` (Guard 1 moves fully inside the plugin)
   - Skip orchestrator sessions and `prAutoDetect === "off"` sessions (same conditions as current lifecycle manager lines 571-578)
   - For sessions with PR: call `pollReviewThreads(session)` with internal throttle
   - Return `Map<sessionId, SessionPollResult>`

4. Add `checkAuth()`:
   - Run `gh --version` → throw with install instructions if missing
   - Run `gh auth status` → throw with auth instructions if not authenticated
   - Reuse existing `execCli` helper from the plugin

**Tests: `packages/plugins/scm-github/test/index.test.ts`**

Add `describe("poll()")` block:
- Returns enrichment for sessions with PRs (mock batch response)
- Detects PRs for sessions without PR when Guard 1 permits
- Skips PR detection when Guard 1 says unchanged
- Throttles review threads to 2-minute intervals
- Returns `null` reviewThreads when throttled
- Handles batch failure gracefully (returns null enrichment)
- Skips orchestrator sessions and `prAutoDetect === "off"`

Add `describe("checkAuth()")`:
- Throws with install message when `gh` missing
- Throws with auth message when not authenticated
- Succeeds when authenticated

---

## Phase 3: GitLab plugin `poll()` + `checkAuth()`

**File: `packages/plugins/scm-gitlab/src/index.ts`**

Same structure as GitHub but without batch optimization:

1. Add `lastReviewPollAt` and throttle constant.

2. Add `poll()`:
   - For sessions with PR: parallel-call `getPRState()`, `getCISummary()`, `getReviewDecision()`, `getMergeability()` → assemble `PREnrichmentData`. Call `getReviewThreads()` with internal throttle.
   - For sessions without PR: call `detectPR()` (no Guard 1 — GitLab has no ETag support)
   - Skip orchestrator sessions and `prAutoDetect === "off"`
   - Return `Map<sessionId, SessionPollResult>`

3. Add `checkAuth()`:
   - Run `glab --version` → throw with install instructions
   - Run `glab auth status` → throw with auth instructions

**Tests: `packages/plugins/scm-gitlab/test/index.test.ts`**

Mirror GitHub test structure using `mockGlab()`.

---

## Phase 4: Lifecycle manager refactor

**File: `packages/core/src/lifecycle-manager.ts`**

This is the core change. Executed in sub-steps:

### 4a: Add `pollReviewResults` cache

At line ~433 (near existing `lastReviewBacklogCheckAt`):

```typescript
const pollReviewResults = new Map<string, ReviewThreadsResult>();
```

### 4b: Rename `populatePREnrichmentCache` → `populatePREnrichmentCacheLegacy`

Keep the existing function body intact as the fallback path for plugins without `poll()`.

### 4c: Add `pollSCMSessions()` function

Replace the old `populatePREnrichmentCache` call with a new function (~50 lines) that:

1. Clears `prEnrichmentCache`, `prListUnchangedRepos`, `pollReviewResults`
2. Groups sessions by `project.scm.plugin`
3. For each plugin:
   - If `scm.poll` exists → call it, iterate results:
     - Apply `detectedPR` to `session.pr` + write metadata
     - Populate `prEnrichmentCache` (keyed by `"${owner}/${repo}#${number}"` — same key format as today)
     - Populate `pollReviewResults` (keyed by `sessionId`)
   - If no `poll()` → call `populatePREnrichmentCacheLegacy(sessions)`
4. Extract the observer construction into `buildBatchObserver(pluginKey)` helper

### 4d: Modify `maybeDispatchReviewBacklog()`

Currently fetches review threads itself (lines 1409-1416). Change to:

1. Check `pollReviewResults.get(session.id)` first
2. If found → use those threads (plugin handled throttling)
3. If not found AND `scm.poll` exists → `null` means throttled, skip, preserve metadata
4. If not found AND no `poll()` → use existing fetch path with lifecycle manager's own throttle (legacy fallback)

The fingerprinting, `isBot` splitting, reaction dispatch, and metadata persistence logic stays exactly as-is. Only the data source changes.

### 4e: Persist review comments from poll results

In `persistPREnrichmentToMetadata()` (line 615), after the existing enrichment blob write, add: if `pollReviewResults.has(session.id)`, persist `prReviewComments` metadata blob (same format as current `maybeDispatchReviewBacklog` lines 1424-1438). This ensures the dashboard gets fresh review data from `poll()`.

### 4f: Update call sites

In `pollAll()` (line 2211):
```
- await populatePREnrichmentCache(sessionsToCheck);
+ await pollSCMSessions(sessionsToCheck);
```

In `check()` (line 2329):
```
- await populatePREnrichmentCache([session]);
+ await pollSCMSessions([session]);
```

Add `pollReviewResults` to the stale-entry pruning loop (line 2234).

### 4g: No changes needed to

- `determineStatus()` — still reads from `prEnrichmentCache` (same Map, same keys)
- `maybeDispatchMergeConflicts()` — still reads from `prEnrichmentCache`
- `resolvePREnrichmentDecision()` / `resolvePRLiveDecision()` — unchanged
- CI check detail for reaction messages — still reads `cachedData.ciChecks` from `prEnrichmentCache`

**Invariants preserved:**
- `prEnrichmentCache` populated before `checkSession()` runs (same ordering in `pollAll`)
- `persistPREnrichmentToMetadata()` runs after `checkSession()` (same ordering)
- Review fingerprinting and dispatch logic identical — only data source changes
- Terminal state fallback (`getPRState` for merged/closed) still works via `determineStatus()`

### Tests: `packages/core/src/__tests__/lifecycle-manager.test.ts`

Update `createMockSCM()` in `test-utils.ts`:
- Add `poll` mock that delegates to individual method mocks (so existing test overrides of `detectPR`, `enrichSessionsPRBatch`, etc. are reflected in `poll()` results)
- Add `checkAuth` mock

Add new test cases:
- `poll()` provides enrichment data that drives status decisions
- `poll()` detects PR and applies to session
- `poll()` provides review threads that drive review backlog dispatch
- `poll()` returns null reviewThreads (throttled) → lifecycle manager preserves existing metadata
- `poll()` failure → lifecycle manager falls back to legacy path
- Legacy path still works when `poll()` is undefined

---

## Phase 5: Remove hardcoded provider references

### CLI spawn auth check

**File: `packages/cli/src/commands/spawn.ts` (lines 100-105)**

```
- const needsGitHubAuth =
-   project?.tracker?.plugin === "github" ||
-   (options?.claimPr && project?.scm?.plugin === "github");
- if (needsGitHubAuth) {
-   await preflight.checkGhAuth();
- }
+ // SCM auth check (provider-agnostic)
+ if (options?.claimPr && project?.scm?.plugin) {
+   const scm = registry.get<SCM>("scm", project.scm.plugin);
+   if (scm?.checkAuth) await scm.checkAuth();
+ }
+ // Tracker auth (still GitHub-specific until tracker interface gets checkAuth)
+ if (project?.tracker?.plugin === "github") {
+   await preflight.checkGhAuth();
+ }
```

### Web URL builders

**File: `packages/web/src/lib/github-links.ts`**

Rename to `packages/web/src/lib/scm-links.ts`. Make `buildCompareUrl()` derive origin from `pr.url` (same pattern `buildGitHubBranchUrl` already uses at line 58). Keep backward-compatible aliases:

```typescript
export { buildCompareUrl as buildGitHubCompareUrl };
```

**File: `packages/web/src/components/session-detail-utils.ts` (line 54)**

Rename `buildGitHubBranchUrl` → `buildBranchUrl`. Already derives origin from `pr.url`. Add alias:

```typescript
export { buildBranchUrl as buildGitHubBranchUrl };
```

**Update imports in:**
- `SessionDetailPRCard.tsx` — `buildGitHubCompareUrl` → `buildCompareUrl` from `@/lib/scm-links`
- `SessionDetailHeader.tsx` — `buildGitHubBranchUrl` → `buildBranchUrl`
- Any other component importing from `github-links.ts`

**Rename test file:** `packages/web/src/lib/__tests__/github-links.test.ts` → `scm-links.test.ts`. Add test with GitLab-origin PR URL to verify origin derivation works for non-GitHub hosts.

### CLI start clone (low priority)

**File: `packages/cli/src/commands/start.ts` (line 459)**

The `if (parsed.host === "github.com")` clone optimization is a convenience, not a correctness issue — the SSH/HTTPS fallback handles all providers. Add a comment clarifying this and leave as-is for now. A full fix would detect available CLIs (`gh`, `glab`) dynamically.

---

## Phase 6: Update test utilities

**File: `packages/core/src/__tests__/test-utils.ts`**

Update `createMockSCM()`:
- Add `poll` field: `vi.fn()` that delegates to the mock's individual methods (`enrichSessionsPRBatch`, `detectPR`, `getReviewThreads`) so existing test overrides are automatically reflected
- Add `checkAuth` field: `vi.fn().mockResolvedValue(undefined)`

This ensures all existing lifecycle manager tests continue passing — they override individual SCM methods, and `poll()` delegates to those same mocks.

---

## Phase 7: Cleanup

After all tests pass:

1. Add `@deprecated Use poll()` JSDoc to `enrichSessionsPRBatch` in the SCM interface
2. Remove `prListUnchangedRepos` from lifecycle manager (only used in legacy path, can be scoped inside `populatePREnrichmentCacheLegacy`)
3. Scope `lastReviewBacklogCheckAt` inside the legacy branch of `maybeDispatchReviewBacklog`
4. Remove `graphql_batch` metric logging from lifecycle manager (plugin logs its own metrics)
5. Clean up duplicate `BatchObserver` type declaration in `types.ts` if it exists

---

## Dependency graph

```
Phase 1 (types) ──┬──→ Phase 2 (GitHub poll)  ──┐
                  └──→ Phase 3 (GitLab poll)  ──┤
                                                 ├──→ Phase 4 (lifecycle refactor) ──→ Phase 7 (cleanup)
                  Phase 5 (hardcoded refs)  ─────┘
                  Phase 6 (test utils) ──────────┘
```

Phases 2+3 run in parallel. Phase 5 is independent (touches different files). Phase 6 is woven into Phase 4.

---

## Verification

1. `pnpm typecheck` — all packages pass
2. `pnpm test` — all existing tests pass
3. `pnpm --filter @aoagents/ao-web test` — web tests pass
4. Manual test: `ao start` + `ao spawn --issue <issue>` → full lifecycle (PR detection → CI → review → merge → cleanup)
5. Manual test: `ao status` shows correct PR/CI/review data
6. Manual test: dashboard merge button works
7. Grep for `"github"` in `packages/core/src/lifecycle-manager.ts` — zero matches
8. Grep for `=== "github"` in `packages/cli/src/commands/` — only the tracker auth check remains

---

## Files modified

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Add `SessionPollInput`, `SessionPollResult`, `poll()`, `checkAuth()` |
| `packages/core/src/index.ts` | Export new types |
| `packages/core/src/lifecycle-manager.ts` | Add `pollSCMSessions()`, modify `maybeDispatchReviewBacklog()`, modify `persistPREnrichmentToMetadata()`, update `pollAll()` and `check()` call sites |
| `packages/plugins/scm-github/src/index.ts` | Add `poll()`, `checkAuth()`, internal review throttle |
| `packages/plugins/scm-gitlab/src/index.ts` | Add `poll()`, `checkAuth()`, internal review throttle |
| `packages/cli/src/commands/spawn.ts` | Replace `=== "github"` auth check with `scm.checkAuth()` |
| `packages/web/src/lib/github-links.ts` | Rename to `scm-links.ts`, derive origin from `pr.url` |
| `packages/web/src/components/session-detail-utils.ts` | Rename `buildGitHubBranchUrl` → `buildBranchUrl` |
| `packages/web/src/components/SessionDetailPRCard.tsx` | Update import |
| `packages/web/src/components/SessionDetailHeader.tsx` | Update import |
| `packages/core/src/__tests__/test-utils.ts` | Add `poll` and `checkAuth` to mock SCM |
| `packages/core/src/__tests__/lifecycle-manager.test.ts` | Add poll-path tests |
| `packages/plugins/scm-github/test/index.test.ts` | Add poll + checkAuth tests |
| `packages/plugins/scm-gitlab/test/index.test.ts` | Add poll + checkAuth tests |
| `packages/web/src/lib/__tests__/github-links.test.ts` | Rename, add GitLab origin test |
