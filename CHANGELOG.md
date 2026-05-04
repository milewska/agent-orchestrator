# Changelog — Fork Modifications

Append-only history of fork-side changes to `milewska/agent-orchestrator`. **Upstream Composio changesets are tracked separately under each `packages/*/CHANGELOG.md`** — this file records ONLY the fork-only deltas (modifications layered on top of upstream).

## 2026-05-04 — Forked from ComposioHQ@fad75b63

- Forked `ComposioHQ/agent-orchestrator` → `milewska/agent-orchestrator`. Origin = fork; upstream = ComposioHQ.
- Phase 1 of OCT-35 (read + plan, no code changes):
  - Read Linear plugin source at `packages/plugins/tracker-linear/src/index.ts` (727 lines)
  - Read Tracker / Issue / IssueFilters / ProjectConfig / TrackerConfig / SessionSpawnConfig in `packages/core/src/types.ts`
  - Identified `sessionManager.spawn()` at `packages/core/src/session-manager.ts:1098` as the single chokepoint for the autonomyMode guard
  - Identified auto-spawn poller at `packages/web/src/lib/services.ts:329` as the primary caller
- Authored fork-root scaffolding:
  - `MODIFICATION-PLAN.md` — Phase 2 modification surface, file:line citations, 7 open questions for Alex
  - `SPEC.md` — design intent (project filter + autonomyMode default-deny)
  - `CARRYOVER.md` — current operational state of the fork
  - `CHANGELOG.md` (this file) — fork-only delta history
- Test baseline NOT captured this pass (Annie cannot run `pnpm install` due to `node` postinstall script — surfaced as decision for Alex / dispatch).
