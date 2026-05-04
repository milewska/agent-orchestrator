# agent-orchestrator (fork) Carryover
Last updated: 2026-05-04 (~22:50 HST)

## Current state

`38bb1bdb` on `main`, in sync with `origin/main` (`milewska/agent-orchestrator`). One fork-side commit ahead of upstream `fad75b63`. Working tree clean modulo this CARRYOVER refresh + CHANGELOG entry.

**Phase 1 of OCT-35 complete:** fork created, plugin source read, `MODIFICATION-PLAN.md` written, scaffolding committed and pushed in `38bb1bdb`. **Test baseline captured (this pass):** `pnpm install && pnpm build && pnpm test` ran clean — **3235 passed + 40 skipped = 3275 total cases across 26 packages, 0 failures**. Baseline is GREEN. README claims 3288 — 13-case delta below README, likely because the README count is from a slightly earlier state (last release `0.4.0` was at `ef8ac42d`, current HEAD is one refactor commit later at `fad75b63`). 0 failures is the load-bearing fact; absolute count is informational. **No code changes yet** — Phase 2 (OCT-36) starts when Alex green-lights the plan.

**Toolchain:** pnpm `10.33.2` (installed via `npm install -g pnpm`). `package.json` declares `pnpm@9.15.4` as `packageManager`; pnpm 10 ran clean — no version-mismatch errors, install/build/test all green. Node v25.8.2. Install ran the `node-pty` rebuild postinstall successfully (~29s). Build ~tens of seconds. Test ~25s.

## In progress / pending

- **OCT-35** (this Phase 1) — ready to flip to `In Review` in Linear. Plan + scaffolding shipped; baseline backfill committed.
- **OCT-36** (Phase 2 implementation) — queued behind Alex's plan review. Estimated 1 Vishva session + 1 review pass. Modification surface in `MODIFICATION-PLAN.md`. Test baseline `3275 / 0 failed` will be the floor for OCT-36 acceptance (`baseline + Δ green`).

## Open decisions

Captured in `MODIFICATION-PLAN.md` "Open questions for Alex" section (7 items). Highlights:
- **Q1:** `approval-required` semantics — recommend deferring to Phase 3, ship Phase 2 with `manual` + `auto` only.
- **Q2:** `userInitiated` field naming — recommend keeping `userInitiated`.
- **Q5:** Default-deny vs compat-default — recommend strict default-deny (the whole point of the fork).
- **Q7:** CHANGELOG strategy — recommend keeping fork CHANGELOG separate from Composio's per-package changesets to avoid rebase conflicts.

## Recent commits

- `38bb1bdb` (fork) — chore(fork): MODIFICATION-PLAN + carryover scaffolding (OCT-35 Phase 1)
- `fad75b63` (upstream) — refactor(cli): extract resolveOrCreateProject for the not-running path (#1621)
- `ef8ac42d` (upstream) — chore: release 0.4.0 (#1625)
- `7c7ffb56` (upstream) — fix(web): source sidebar orchestrator from API field, not session list (#1623)

## Test baseline detail (per package, captured 2026-05-04)

| Package | Tests passed | Skipped |
|---|---:|---:|
| core | 1059 | 0 |
| cli | 602 | 0 |
| integration-tests | 190 | 35 |
| plugins/agent-codex | 196 | 0 |
| plugins/scm-github | 165 | 5 |
| plugins/agent-claude-code | 158 | 0 |
| plugins/agent-kimicode | 103 | 0 |
| plugins/agent-opencode | 93 | 0 |
| plugins/scm-gitlab | 74 | 0 |
| plugins/tracker-linear | 72 | 0 |
| plugins/agent-cursor | 63 | 0 |
| plugins/tracker-github | 51 | 0 |
| plugins/workspace-worktree | 50 | 0 |
| plugins/agent-aider | 47 | 0 |
| plugins/runtime-process | 42 | 0 |
| plugins/tracker-gitlab | 42 | 0 |
| plugins/workspace-clone | 31 | 0 |
| plugins/notifier-composio | 28 | 0 |
| plugins/notifier-slack | 27 | 0 |
| plugins/notifier-desktop | 26 | 0 |
| plugins/runtime-tmux | 26 | 0 |
| plugins/terminal-iterm2 | 24 | 0 |
| plugins/notifier-webhook | 22 | 0 |
| plugins/notifier-discord | 16 | 0 |
| plugins/notifier-openclaw | 15 | 0 |
| plugins/terminal-web | 13 | 0 |
| **TOTAL** | **3235** | **40** |

**tracker-linear baseline: 72 tests across 2 files** (`index.test.ts` + `composio-transport.test.ts`). Phase 2 will add an estimated +5–7 cases here (project filter on listIssues + createIssue, ISSUE_FIELDS shape).

## Next-tick checklist

- [x] Test baseline captured.
- [ ] Alex reads `MODIFICATION-PLAN.md`, answers the 7 open questions or explicitly defers them.
- [ ] Linear OCT-35 → `In Review` after this CARRYOVER refresh lands.
- [ ] When OCT-35 signed off → start OCT-36 (Phase 2 code changes per the plan).
- [ ] OCT-36 acceptance gate: `pnpm test` returns ≥3275 passed (3235 baseline + Δ new), 0 failed.

## Sources

- `MODIFICATION-PLAN.md` (this fork, root) — modification surface with file:line citations
- `SPEC.md` (this fork, root) — design intent
- `~/Desktop/Octahedron/skills/carryover-writer/SKILL.md` — schema this CARRYOVER follows
- Linear OCT-35 (Phase 1 — read + plan), OCT-36 (Phase 2 — implementation)
- Upstream: `git@github.com:ComposioHQ/agent-orchestrator.git@fad75b63`
- Test baseline raw output: `/tmp/ao-test-summary.txt` (ephemeral, captured this pass)
