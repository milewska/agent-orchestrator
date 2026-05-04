# Fork SPEC — AO Private Modifications

> Design intent for the milewska/agent-orchestrator private fork. Tracks WHY we forked and what the fork adds. Implementation lives elsewhere (see `MODIFICATION-PLAN.md` for the modification surface, `CARRYOVER.md` for current state).

**Upstream:** `github.com/ComposioHQ/agent-orchestrator`
**Fork base:** `fad75b63` on `main` (2026-05-04)
**Linear epic:** OCT-35 (Phase 1, this scaffold) → OCT-36 (Phase 2, code changes)

## Why fork

Composio's AO ships with two safety properties we want to change:

1. **No per-project Linear filter.** AO's Linear plugin filters by `teamId` only. If a Linear team has multiple projects, AO's auto-backlog poller picks up issues from ALL of them. We want to scope AO to a single Linear project per AO project — issues in unrelated projects on the same team must be invisible to AO.

2. **No per-project autonomy posture.** AO's `pollBacklog` auto-spawn loop runs for every project that has a tracker plugin. Once a project is configured, the auto-poller starts spawning agents on any `agent:backlog`-labeled issue. We want explicit per-project opt-in: every project declares `autonomyMode: manual | approval-required | auto`, and **omitting it = manual = no auto-spawn**.

Both gaps are reasonable defaults for the upstream's user base (small teams, single-project workspaces, fast iteration). They are NOT reasonable defaults for our setup — we run AO across many crew agents, multiple Linear projects, and want a hard "this project is not auto-pilot" gate that survives config drift.

## Design

### Project filter (Linear `projectId`)

- New optional `projectId` field on `ProjectConfig.tracker` (Linear-specific, validates via existing `additionalProperties: true` on `trackerConfig`).
- `Tracker.listIssues` reads `project.tracker.projectId` and adds `project: { id: { eq: projectId } }` to the GraphQL filter when present.
- `Tracker.createIssue` passes `projectId` to Linear's `IssueCreateInput` mutation.
- `ISSUE_FIELDS` GraphQL fragment requests `project { id name }` so AO sees Linear project metadata on every issue (useful for dashboard later).
- **Backwards compatible:** absent `projectId` = current behavior (filter by `teamId` only).

### Autonomy mode (per-project, default-deny)

- New `AutonomyMode = "manual" | "approval-required" | "auto"` type.
- Optional `autonomyMode?: AutonomyMode` on `ProjectConfig`. **Runtime default when absent: `"manual"`.**
- New `userInitiated?: boolean` on `SessionSpawnConfig`. Manual CLI sets `true`; auto-poller leaves `false`.
- Single guard at `sessionManager.spawn()` chokepoint:
  - `manual` + not user-initiated → `SpawnBlockedError` thrown, activity event emitted with `kind: "session.spawn_blocked"`.
  - `approval-required` + not user-initiated → `SpawnPendingApprovalError` (Phase 3 — deferred from Phase 2).
  - `auto` OR user-initiated → spawn proceeds normally.
- The auto-spawn poller (`packages/web/src/lib/services.ts:329`) catches `SpawnBlockedError` and silently continues; `SpawnPendingApprovalError` produces a pending-approval event.
- The manual CLI spawn (`packages/cli/src/commands/spawn.ts`) passes `userInitiated: true` and surfaces a friendly error if the guard rejects (e.g., "set `autonomyMode: auto` in your config").

### Default-deny rationale

The whole point of forking is the safety posture. Compatibility-default (existing configs default to `auto`, only new configs default to `manual`) preserves the upstream behavior we're trying to remove. **Strict default-deny** — every project must opt in — is the only setting that delivers the safety property we forked for. The migration ask is one line per project; the failure mode is a loud, clear error pointing at the fix.

## What this fork does NOT change

- No changes to plugin slot architecture or plugin loader.
- No changes to GitHub or GitLab tracker plugins.
- No changes to runtime, agent, workspace, terminal, notifier, SCM plugins.
- No changes to Composio's Changesets release flow.
- No renames or structural refactors that would conflict with upstream-sync rebases.

## Upstream-sync policy

- `upstream` remote points at `git@github.com:ComposioHQ/agent-orchestrator.git`.
- We periodically `git fetch upstream && git rebase upstream/main` (or merge — TBD).
- Our fork-only modifications are limited to additive changes: new optional fields, new exports, new conditional branches inside existing functions, new schema properties.
- If upstream introduces a conflicting `autonomyMode` field with different semantics, that's the cue to either (a) upstream a PR aligning semantics, or (b) rename our fields to avoid collision.

## Doc hierarchy at fork root

| File | Role | Edited by |
|---|---|---|
| `SPEC.md` (this file) | Design intent for the fork | Human only |
| `MODIFICATION-PLAN.md` | Phase 2 modification surface (file/line citations + open questions) | Annie / engineering crew |
| `CARRYOVER.md` | Current operational state of the fork | Hermione (carryover-writer skill) |
| `CHANGELOG.md` | Append-only history of fork-side changes | Hermione |
| (upstream files: `README.md`, `SETUP.md`, `CONTRIBUTING.md`, etc.) | Upstream-owned, untouched by fork | Composio |

This is the carryover system from `~/Desktop/Octahedron/scripts/hermione-daily.md` applied to the fork — `MODIFICATION-PLAN.md` is fork-specific scaffolding alongside the standard SPEC/CARRYOVER/CHANGELOG triad.
