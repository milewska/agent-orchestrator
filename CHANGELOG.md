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
- **Test baseline backfilled same day** (after Alex approved `npm install -g pnpm`): `pnpm install && pnpm build && pnpm test` ran clean — **3235 passed + 40 skipped = 3275 total cases across 26 packages, 0 failures**. README claims 3288; 13-case delta below README is informational (likely README slightly stale; current HEAD `fad75b63` is one refactor commit past the `0.4.0` release at `ef8ac42d`). 0 failures is the load-bearing fact. tracker-linear baseline: 72 tests across 2 files. Toolchain: pnpm 10.33.2, Node v25.8.2.
