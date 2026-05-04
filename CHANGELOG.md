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

## 2026-05-04 — OCT-38 coverage + docs smoke

- Audited OCT-36/OCT-37 coverage and added focused gaps:
  - Linear project filter now asserts no `project` filter without `projectId`, ID-based filtering instead of returned project name, no create mutation `projectId` when omitted, and Composio transport variable propagation.
  - CLI spawn now asserts `--project` resolves AO project IDs, not display names.
  - Core autonomy helpers now cover default-deny omission, manual/full/review spawn permission, full reaction preservation, review-mode suppression, and omitted-mode suppression.
- Documented fork-only surfaces in README, `agent-orchestrator.yaml.example`, and `FORK-FEATURES.md`.
- Smoke verification:
  - `pnpm build` clean after fresh install (build required to materialize package `dist/` links before root typecheck).
  - `pnpm typecheck` clean.
  - `pnpm test` clean — **3263 passed + 40 skipped = 3303 total cases across 26 test-running packages, 0 failures**.
  - Focused web services check: `pnpm --filter @aoagents/ao-web test -- src/__tests__/services.test.ts` clean — **7 passed, 0 failures**.
