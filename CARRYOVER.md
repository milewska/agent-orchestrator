# agent-orchestrator (fork) Carryover
Last updated: 2026-05-04 (~21:30 HST)

## Current state

`fad75b63` on `main`, in sync with `origin/main` (`milewska/agent-orchestrator`). Fork base matches `upstream/main` (`ComposioHQ/agent-orchestrator`). Working tree clean except for new fork-scaffolding files (this CARRYOVER, SPEC, MODIFICATION-PLAN, CHANGELOG) which land in the same commit.

**Phase 1 of OCT-35 complete:** fork created, cloned to `~/Desktop/Annie Projects/agent-orchestrator/`, plugin source read, `MODIFICATION-PLAN.md` written. **No code changes yet** — Phase 2 (OCT-36) starts when Alex green-lights the plan.

**Test baseline NOT yet run.** `pnpm` not installed on this machine; running `pnpm install` triggers a `node scripts/rebuild-node-pty.js` postinstall that crosses Annie's `node/python execution` hard limit. Surfaced to Alex — either he runs the install + test cycle once for the baseline, or it's delegated to Vishva via `dispatch.sh vishva` for the same one-time install + test pass. Plan does not depend on test results — it's a code-reading exercise.

## In progress / pending

- **OCT-35** (this Phase 1) — `In Progress` in Linear; flip to `In Review` when committed and pushed.
- **OCT-36** (Phase 2 implementation) — queued behind Alex's plan review. Estimated 1 Vishva session + 1 review pass. Modification surface is in `MODIFICATION-PLAN.md`.
- **Test baseline backfill** — pending. Once test count + any failures are captured, append to this CARRYOVER's `## Current state` section in the next Hermione pass.

## Open decisions

Captured in `MODIFICATION-PLAN.md` "Open questions for Alex" section (7 items). Highlights:
- **Q1:** `approval-required` semantics — recommend deferring to Phase 3, ship Phase 2 with `manual` + `auto` only.
- **Q2:** `userInitiated` field naming — recommend keeping `userInitiated`.
- **Q5:** Default-deny vs compat-default — recommend strict default-deny (the whole point of the fork).
- **Q7:** CHANGELOG strategy — recommend keeping fork CHANGELOG separate from Composio's per-package changesets to avoid rebase conflicts.

## Recent commits

(Fork is at upstream HEAD — no fork-side commits yet beyond this initial scaffolding.)

- `fad75b63` (upstream) — refactor(cli): extract resolveOrCreateProject for the not-running path (#1621)
- `ef8ac42d` (upstream) — chore: release 0.4.0 (#1625)
- `7c7ffb56` (upstream) — fix(web): source sidebar orchestrator from API field, not session list (#1623)

The first fork-side commit will be the one introducing this CARRYOVER + SPEC + MODIFICATION-PLAN + CHANGELOG.

## Next-tick checklist

- [ ] Alex reads `MODIFICATION-PLAN.md`, answers the 7 open questions or explicitly defers them.
- [ ] Test baseline captured (Alex runs locally OR dispatch to Vishva). Result appended to CARRYOVER `## Current state`.
- [ ] Linear OCT-35 → `In Review` after this commit lands.
- [ ] When OCT-35 signed off → start OCT-36 (Phase 2 code changes per the plan).

## Sources

- `MODIFICATION-PLAN.md` (this fork, root) — modification surface with file:line citations
- `SPEC.md` (this fork, root) — design intent
- `~/Desktop/Octahedron/skills/carryover-writer/SKILL.md` — schema this CARRYOVER follows
- Linear OCT-35 (Phase 1 — read + plan), OCT-36 (Phase 2 — implementation)
- Upstream: `git@github.com:ComposioHQ/agent-orchestrator.git@fad75b63`
