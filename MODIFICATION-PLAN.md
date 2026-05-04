# MODIFICATION-PLAN — AO Private Fork

**Phase:** 1 (read + plan only — no code changes yet)
**Linear:** OCT-35
**Fork base:** `ComposioHQ/agent-orchestrator@fad75b63` (main)
**Author:** Annie

---

## Goal

Add two capabilities to AO's Linear plugin without breaking upstream-sync compatibility:

1. **Per-project Linear `projectId` filter** — issues are filtered to a single Linear project (in addition to the existing `teamId` filter), so AO's auto-backlog poller only picks up issues from the project we want.
2. **Per-project `autonomyMode` + spawn-time guard** — every project declares its autonomy posture (`manual` / `approval-required` / `auto`). The session-manager `spawn()` function refuses to launch worker sessions on `manual` projects unless an explicit user-initiated override is passed in. **Default is deny-by-omission: any project that doesn't declare `autonomyMode` is treated as `manual`.**

Phase 2 (OCT-36) implements these. Phase 1 (this plan) documents the modification surface so Alex can sanity-check the design before code lands.

---

## Current behavior (with file:line citations)

### Linear plugin shape

The Linear tracker plugin lives at **`packages/plugins/tracker-linear/src/index.ts`** (727 lines). It implements the `Tracker` interface from `@aoagents/ao-core`. Two transports auto-detected from env: `LINEAR_API_KEY` (direct GraphQL) or `COMPOSIO_API_KEY` (Composio SDK relay).

> **Brief assumption correction:** the plugin is at `packages/plugins/tracker-linear/`, not `packages/plugin-linear/`. AO uses `packages/plugins/<slot>-<name>/` for all 21 plugins (7 slots × 1–6 implementations).

### Filter construction today

`Tracker.listIssues(filters: IssueFilters, project: ProjectConfig)` is the read path. The `IssueFilters` interface (`packages/core/src/types.ts:711-716`) supports only **state / labels / assignee / limit** — no project field.

The Linear plugin builds the GraphQL filter at `packages/plugins/tracker-linear/src/index.ts:381-407`:

```ts
// (line 402-405)
const teamId = project.tracker?.["teamId"];
if (teamId) {
  filter["team"] = { id: { eq: teamId } };
}
```

`teamId` is the ONLY project-level filter today. The Linear `project` field on issues is **dropped at the plugin layer**: the GraphQL `ISSUE_FIELDS` fragment (`tracker-linear/src/index.ts:257-269`) requests `id identifier title description url priority branchName state labels assignee team`, but **not `project`**. AO has no visibility into which Linear project an issue belongs to.

### Spawn flow today

The call chain that needs the safety guard:

1. **Auto-spawn (web pollBacklog):** `packages/web/src/lib/services.ts:272-340` — every poll tick, for each project, `tracker.listIssues({ state: "open", labels: [BACKLOG_LABEL] })` returns issues, then `sessionManager.spawn({ projectId, issueId })` is called for each not-already-active issue (line 329). Auto-scaling cap: `MAX_CONCURRENT_AGENTS`.
2. **Manual spawn (CLI):** `packages/cli/src/commands/spawn.ts` (419 lines) — `ao spawn` command. Resolves project via `autoDetectProject()`, calls into the same `sessionManager.spawn()` chokepoint.
3. **Programmatic spawn (web POST):** `packages/web/src/app/api/issues/route.ts` and similar API routes also reach into `sessionManager`.

**Chokepoint:** `packages/core/src/session-manager.ts:1098` — `async function spawn(spawnConfig: SessionSpawnConfig): Promise<Session>`. Every spawn path goes through this single function. **This is where the autonomyMode guard sits.**

### `SessionSpawnConfig` shape

`packages/core/src/types.ts:362-371`:

```ts
export interface SessionSpawnConfig {
  projectId: string;
  issueId?: string;
  branch?: string;
  prompt?: string;
  agent?: string;
  subagent?: string;
}
```

No autonomy/override flag today. Phase 2 adds an opt-in `userInitiated?: boolean` (or similarly named) field that the manual CLI path sets `true` and the web auto-poller leaves undefined.

### Tracker contract (`packages/core/src/types.ts:668-732`)

```ts
export interface Tracker {
  readonly name: string;
  getIssue(id, project): Promise<Issue>;
  isCompleted(id, project): Promise<boolean>;
  issueUrl(id, project): string;
  issueLabel?(url, project): string;
  branchName(id, project): string;
  generatePrompt(id, project): Promise<string>;
  listIssues?(filters, project): Promise<Issue[]>;       // ← optional
  updateIssue?(id, update, project): Promise<void>;      // ← optional
  createIssue?(input, project): Promise<Issue>;          // ← optional
}
```

`Issue` (line 699-709) has no `projectId` / `project` field. Phase 2 may add it (see "Open questions" below).

### Config schema

- **`schema/config.schema.json:127-148`** — `trackerConfig` `$defs` block. `additionalProperties: true` (line 129) — meaning **any plugin-specific field already validates today**. We can add `projectId` to TrackerConfig WITHOUT modifying the schema's required fields. The schema does, however, document only `plugin / package / path`. We should add `teamId` and `projectId` (Linear) and `autonomyMode` (project-level) explicitly so dashboard-side validators see them.
- **`schema/config.schema.json:328-330`** — `tracker` is `$ref: "#/$defs/trackerConfig"` inside the project schema.
- **`agent-orchestrator.yaml.example:65-70`** — Linear example currently shows `plugin: linear` + `teamId`. No project filter, no autonomyMode.

---

## Files to modify — Project filter

### Required changes (3 files)

1. **`packages/plugins/tracker-linear/src/index.ts`**
   - **`listIssues` (~line 402-407):** read `project.tracker?.["projectId"]` and append to filter:
     ```ts
     const projectId = project.tracker?.["projectId"];
     if (projectId) {
       filter["project"] = { id: { eq: projectId } };
     }
     ```
   - **`createIssue` (~line 583):** add `projectId` to mutation variables and the `issueCreate` input. Linear's GraphQL `IssueCreateInput` accepts `projectId` directly — no extra round trip.
   - **`ISSUE_FIELDS` (lines 257-269):** add `project { id name }` to the fragment so AO sees which Linear project each issue belongs to. Optional but useful for the dashboard later (and required if we want `Issue.projectId` typed in core).

2. **`packages/core/src/types.ts`**
   - **`Issue` (line 699-709):** add optional `project?: { id: string; name: string }` field. Backwards-compatible (optional). Other tracker plugins (GitHub, GitLab) leave it undefined.
   - **No change to `IssueFilters`.** The project filter is sourced from `ProjectConfig.tracker.projectId`, not `IssueFilters` — it's a **per-project static binding**, not a per-call filter. This matches how `teamId` works today.

3. **`schema/config.schema.json` (~line 127-148)**
   - Add documented properties to `trackerConfig`:
     ```jsonc
     "teamId":    { "type": "string", "description": "Linear team ID. Required for tracker-linear." },
     "projectId": { "type": "string", "description": "Linear project ID. Optional; restricts listIssues + createIssue to a single project." },
     "workspaceSlug": { "type": "string", "description": "Linear workspace slug for issueUrl construction." }
     ```
   - `additionalProperties: true` already permits these — this is documentation-only for IDE autocomplete and dashboard validation.

4. **`agent-orchestrator.yaml.example`**
   - Update the Linear example block (~line 64-70) to show `projectId` alongside `teamId`. Add a comment noting the filter is restrictive (issues outside this project are invisible to AO).

### Optional / nice-to-have

- **`packages/plugins/tracker-linear/src/index.ts` `getIssue` (line 279-301):** currently never validates that the fetched issue belongs to the configured project. If someone passes `getIssue("OCT-99")` and OCT-99 is in a different Linear project, AO gets it anyway. Decision: **defer** — the `getIssue` path is direct lookup by identifier, not a filter; filtering it would change behavior in unexpected ways.

---

## Files to modify — autonomyMode + spawn-time guard

### Required changes (4 files)

1. **`packages/core/src/types.ts`**
   - Add `AutonomyMode` type:
     ```ts
     export type AutonomyMode = "manual" | "approval-required" | "auto";
     ```
   - Extend `ProjectConfig` (line 1437-1507): add `autonomyMode?: AutonomyMode` (optional in the type — but treated as `"manual"` at runtime if absent — see guard logic below).
   - Extend `SessionSpawnConfig` (line 362-371): add `userInitiated?: boolean`. Defaults `false` when omitted. The CLI `ao spawn` command sets `true`; the web auto-poller leaves it `false`.

2. **`packages/core/src/session-manager.ts`**
   - **`spawn()` (line 1098-1119):** add the guard at the top of the function, BEFORE `recordActivityEvent`:
     ```ts
     async function spawn(spawnConfig: SessionSpawnConfig): Promise<Session> {
       const project = config.projects[spawnConfig.projectId];
       if (!project) throw new Error(`Unknown project: ${spawnConfig.projectId}`);

       const mode: AutonomyMode = project.autonomyMode ?? "manual"; // ← default-deny
       const userInitiated = spawnConfig.userInitiated === true;

       if (mode === "manual" && !userInitiated) {
         recordActivityEvent({
           projectId: spawnConfig.projectId,
           source: "session-manager",
           kind: "session.spawn_blocked",
           level: "warn",
           summary: `spawn blocked — project autonomyMode='manual' and spawn not user-initiated`,
           data: { issueId: spawnConfig.issueId, mode },
         });
         throw new SpawnBlockedError(spawnConfig.projectId, mode);
       }
       if (mode === "approval-required" && !userInitiated) {
         // emit pending-approval event, return without spawning, OR enqueue
         // (exact shape decided in Phase 2 — see "Open questions" below)
         throw new SpawnPendingApprovalError(spawnConfig.projectId, spawnConfig.issueId);
       }

       // ... existing recordActivityEvent + try/catch as today
     }
     ```
   - Note: the project lookup is duplicated with `_spawnInner` (line 1124-1127) — Phase 2 may refactor to a single guard-then-delegate pattern.
   - Add new error classes (`SpawnBlockedError`, `SpawnPendingApprovalError`) so callers can distinguish guard rejections from runtime failures.

3. **`packages/cli/src/commands/spawn.ts`**
   - The CLI manual spawn IS user-initiated. Pass `userInitiated: true` when constructing the `SessionSpawnConfig`. One line change at the spawn call site.
   - Add a friendly error message if `SpawnBlockedError` is caught — "this project is `manual` mode; use `ao project autonomy <projectId> --mode auto` to enable auto-spawn."

4. **`packages/web/src/lib/services.ts`**
   - **`pollBacklog()` (line 272-340):** the auto-poller leaves `userInitiated` undefined / false. The guard now silently rejects manual-mode projects. Wrap the `sessionManager.spawn()` call in try/catch for `SpawnBlockedError` (drop silently — expected when project is manual) vs `SpawnPendingApprovalError` (record a pending-approval entry the dashboard can surface).
   - **Web POST routes** (e.g. `packages/web/src/app/api/issues/route.ts` and any future spawn-trigger routes): if the request comes from a logged-in operator clicking a button, set `userInitiated: true`. If it's from a webhook or background trigger, leave it false.

### Schema additions

5. **`schema/config.schema.json` — project schema (~line 320+):**
   - Add `autonomyMode`:
     ```jsonc
     "autonomyMode": {
       "type": "string",
       "enum": ["manual", "approval-required", "auto"],
       "description": "Per-project autonomy posture. 'manual' (default): only user-initiated spawns allowed; auto-poller is disabled for this project. 'approval-required': auto-poller marks issues as pending-approval. 'auto': auto-poller spawns freely up to MAX_CONCURRENT_AGENTS. **Omitted = manual.**"
     }
     ```

6. **`agent-orchestrator.yaml.example` (~line 64-70 project block):**
   - Add `autonomyMode: manual` to the example with a comment explaining the default-deny safety posture.

---

## Estimated test surface

### Existing test files that need new cases

- **`packages/plugins/tracker-linear/test/index.test.ts`** — add cases for:
  - `listIssues` with `projectId` filter (assert filter object includes `project.id.eq`)
  - `listIssues` without `projectId` (assert filter object does NOT include `project`)
  - `createIssue` with `projectId` (assert mutation includes the field)
  - `ISSUE_FIELDS` includes `project` (assert by query string match)
- **`packages/plugins/tracker-linear/test/composio-transport.test.ts`** — add case ensuring projectId flows through Composio relay too. Likely 1 new test.
- **`packages/core/src/__tests__/session-manager.test.ts`** — add cases for:
  - `spawn()` rejects when `autonomyMode === "manual"` and `userInitiated !== true` → throws `SpawnBlockedError`
  - `spawn()` proceeds when `autonomyMode === "manual"` and `userInitiated === true`
  - `spawn()` proceeds when `autonomyMode === "auto"` regardless of `userInitiated`
  - `spawn()` enters pending-approval path when `autonomyMode === "approval-required"` and `userInitiated !== true`
  - `spawn()` defaults to `manual` when `autonomyMode` is absent (default-deny invariant)
- **`packages/cli/__tests__/commands/spawn.test.ts`** (if it exists — check during Phase 2) — add case asserting `userInitiated: true` is passed.
- **`packages/web/src/lib/__tests__/services.test.ts`** (if exists) — assert pollBacklog handles `SpawnBlockedError` silently and `SpawnPendingApprovalError` produces a pending-approval event.

### New test file recommendation

- **`packages/core/src/__tests__/autonomy-mode-guard.test.ts`** (new, ~6-10 cases) — isolated unit tests for the guard logic, decoupled from full session-manager spawn rollout. Easier to expand as `approval-required` semantics solidify.

### Test count estimate

- Linear plugin: +5–7 cases
- Session-manager guard: +5 cases (existing file) + 6–10 cases (new file) = 11–15
- CLI: +1–2 cases
- Web services: +2 cases

**Total estimated new test cases: ~20–25** added on top of upstream's 3,288.

---

## Open questions for Alex

1. **`approval-required` semantics — pending-approval surface.** Where does the pending-approval entry live? Three options:
   - **(a)** New table in events DB with status `pending_approval` — operator approves via dashboard button → spawn fires.
   - **(b)** Reuse the existing `agent:backlog` label flow — the auto-poller writes a `agent:pending-approval` label on the Linear issue and skips spawn until the label is removed by an operator.
   - **(c)** Defer: ship Phase 2 with `manual` and `auto` only; add `approval-required` as Phase 3.
   - **My recommendation:** (c). Keep Phase 2 surgical. `approval-required` adds a UI flow that needs its own design pass. Two modes is enough to ship the safety guard.

2. **`userInitiated` naming.** I used `userInitiated` because it's literal — "did a human directly request this?" Alternative names: `manual: true`, `force: true`, `bypassAutonomyGuard: true`, `interactive: true`. Pick one. `userInitiated` is the clearest about intent IMO.

3. **Web POST routes — which are user-initiated?** The web dashboard exposes `POST /api/issues` (creates an issue, optionally adds to backlog) and possibly direct spawn endpoints. If the request is authenticated as the operator clicking a button in the dashboard UI, `userInitiated: true`. If it's a webhook or background trigger, `userInitiated: false`. Need to audit each POST route during Phase 2 — there's no shortcut around per-route review.

4. **Should `getIssue` validate project membership?** Currently `getIssue("OCT-99", project)` returns the issue regardless of which Linear project OCT-99 is in. If we add the project filter, should `getIssue` also enforce it (404 if mismatch) or remain permissive? **My lean:** keep `getIssue` permissive — it's used for already-known issue identifiers, often surfaced from places that already validated provenance. Filtering it would surprise existing callers.

5. **Backwards-compat for existing AO users on the fork.** A user with no `autonomyMode` in their config gets default-deny → their auto-poller stops working. This is the entire point of the safety guard, but it IS a behavior change. Two options:
   - **Strict default-deny** (recommended): every config must opt in. Migration: README + CHANGELOG note + a clear `SpawnBlockedError` message that points at the fix.
   - **Compatibility default-allow**: existing configs default to `auto`, only NEW projects default to `manual`. Less safe, harder to reason about.
   - **My lean:** strict default-deny. The whole reason we're forking is to enforce the safety posture — the migration ask is small (one line per project) and the failure mode is loud (clear error, easy fix).

6. **Per-project Linear `projectId`: where does the operator find the value?** Linear surfaces project IDs only in URLs and the API. Should AO add a `ao project linear-projects --team <teamId>` helper command to list available projects + their IDs? Nice-to-have, not Phase 2 blocker.

7. **CHANGELOG strategy for the fork.** Composio runs Changesets (`pnpm changeset`). Do our fork-internal modifications create their own changeset entries (would conflict with upstream sync), or do we keep our changes outside the changeset flow and document them only in `CHANGELOG.md` at fork root? **My lean:** outside changesets. Our modifications are package-spanning fork-only deltas; mixing them into Composio's per-package changeset stream complicates upstream-sync rebases. Use `CHANGELOG.md` at fork root for our deltas; let upstream changesets continue to flow through unchanged.

---

## Upstream-sync compatibility considerations

All Phase 2 modifications avoid renaming/restructuring upstream files — we ONLY:
- Append new optional fields to existing types (`Issue.project`, `ProjectConfig.autonomyMode`, `SessionSpawnConfig.userInitiated`).
- Add new exports (`AutonomyMode` type, `SpawnBlockedError` class).
- Add new conditional blocks inside existing functions (`listIssues` projectId branch, `spawn()` guard).
- Add new schema properties (additive only — no removals).

This keeps `git pull upstream main` rebases clean. If Composio later adds their own `autonomyMode` field with different semantics, we'll have a real merge conflict — but that's a future-Annie problem and is a clear signal to upstream a PR rather than maintain divergent semantics.

---

## Phase 2 estimated scope

- **Code changes:** 4 files modified (`tracker-linear/src/index.ts`, `core/src/types.ts`, `core/src/session-manager.ts`, `cli/commands/spawn.ts`) + 2 schema/example files + 1 web service file. **~150–250 net lines added.**
- **Tests:** ~20–25 new cases, 1 new test file.
- **Docs:** README section explaining autonomyMode + project filter; SETUP.md migration note for existing users.
- **Estimated time:** 1 build session for Vishva (or paired Bridget) + 1 review pass.

---

## Verification gate (Phase 2 acceptance)

Before flipping the OCT-36 task to `review`:
- [ ] All upstream tests still pass (3,288 baseline + new cases).
- [ ] New tests cover the default-deny invariant explicitly.
- [ ] Manual smoke: configure a project with `autonomyMode: manual`, observe pollBacklog skips it; configure `autonomyMode: auto`, observe spawn proceeds.
- [ ] `ao spawn <projectId>` succeeds on manual-mode project (sets `userInitiated: true`).
- [ ] Linear projectId filter restricts `listIssues` results to the configured project (verified with two projects in the same team).
- [ ] `MODIFICATION-PLAN.md` open questions are resolved (or explicitly deferred to Phase 3).
- [ ] Upstream rebase from `ComposioHQ/agent-orchestrator@main` applies cleanly.

---

## File / line citation index (quick-jump)

| What | Where |
|---|---|
| Linear plugin entry | `packages/plugins/tracker-linear/src/index.ts:1` |
| `listIssues` filter construction | `packages/plugins/tracker-linear/src/index.ts:381-434` |
| `teamId` filter today | `packages/plugins/tracker-linear/src/index.ts:402-405` |
| `ISSUE_FIELDS` GraphQL fragment (no project today) | `packages/plugins/tracker-linear/src/index.ts:257-269` |
| `createIssue` mutation (uses teamId only) | `packages/plugins/tracker-linear/src/index.ts:577-703` |
| Tracker interface | `packages/core/src/types.ts:668-697` |
| `Issue` shape (no project field today) | `packages/core/src/types.ts:699-709` |
| `IssueFilters` (no project field) | `packages/core/src/types.ts:711-716` |
| `SessionSpawnConfig` | `packages/core/src/types.ts:362-371` |
| `ProjectConfig` (where autonomyMode goes) | `packages/core/src/types.ts:1437-1507` |
| `TrackerConfig` (additionalProperties: true) | `packages/core/src/types.ts:1509-1527` |
| `sessionManager.spawn()` chokepoint | `packages/core/src/session-manager.ts:1098` |
| Auto-spawn poller loop | `packages/web/src/lib/services.ts:272-340` |
| Auto-spawn invocation site | `packages/web/src/lib/services.ts:329` |
| Manual CLI spawn | `packages/cli/src/commands/spawn.ts:1` |
| Web issues list/create route | `packages/web/src/app/api/issues/route.ts:1` |
| Config schema — trackerConfig | `schema/config.schema.json:127-148` |
| Config schema — project tracker ref | `schema/config.schema.json:328-330` |
| Example yaml — Linear stanza | `agent-orchestrator.yaml.example:65-70` |
