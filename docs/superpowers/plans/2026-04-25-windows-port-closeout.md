# Windows Port — Closeout

**Branch:** `feat/windows-platform-adapter`
**Status:** All planned tasks shipped. One item deferred (waiting upstream).

This file replaces six earlier plans:

- `2026-04-07-windows-compatibility.md` — initial port plan (`runtime: process`, `platform.ts`, CI matrix)
- `2026-04-09-windows-qa-fixes.md` — first QA round (PowerShell-safe shellEscape, PID-based `isAlive`)
- `2026-04-10-windows-blockers-complete.md` — inventory of cross-cutting blockers
- `2026-04-10-windows-pty-host.md` — ConPTY-via-named-pipe PTY host (the tmux equivalent on Windows)
- `2026-04-11-windows-test-failures.md` — pre-merge Windows test inventory
- `2026-04-16-windows-bug-fixes.md` — final 11-task punch list

---

## What shipped

### Foundations (earlier on the branch)

- `platform.ts` cross-platform adapter (shell resolution, kill-tree, port discovery, env defaults)
- `runtime-process` plugin as the Windows default; tmux remains default on Unix
- ConPTY-based PTY host: `runtime-process` spawns a per-session helper that owns a `node-pty` and exposes a Windows named pipe (`\\.\pipe\ao-pty-{hash}-{sessionId}`) — the dashboard mux WS, `sendMessage`, and `getOutput` all relay through it. Unix path unchanged.
- `shellEscape` is PowerShell-safe on Windows; activity-log + metadata writes are atomic with retry to survive AV/indexer locking
- Storage hash is stable across drive letters / casing on Windows

### 11-task punch list (2026-04-16)

| # | Issue | Fix |
|---|-------|-----|
| 1 | `windowsHide: true` missing on subprocess spawns → console flashes during `ao stop`, `ao doctor`, etc. | Added across `platform.ts`, `script-runner.ts`, `tmux.ts`, `session-manager.ts`, `workspace-worktree`, `runtime-process` |
| 2 | Codex binary unresolved on Windows (`gh` only, no `.exe`/`.cmd`) | `where.exe` lookup with `gh.cmd`/`gh.exe` and known npm-shim / cargo paths as fallbacks |
| 3 | Codex launch broken under PowerShell quoted-path execution | Prepend `& ` (call operator) on Windows in `getLaunchCommand`/`getRestoreCommand` |
| 4 | Dashboard never started Windows sessions because `runtime-process` was unregistered | Added to `web/package.json` + `web/src/lib/services.ts` registry |
| 5 | `ao open` failed on process runtime (assumed tmux) | Session-manager fallback emits a viewable URL for each session |
| 6 | `ao doctor` failed without bash on PATH | Auto-detect `C:\Program Files\Git\bin\bash.exe` (and variants); shell-script failure non-fatal on Windows |
| 7 | Stale git worktree registry blocked re-spawn after AV/restart | `git worktree prune` before each `git worktree add` |
| 8 | `node_modules` symlink fallback copied recursively (slow + bloat) | Junction for directories, hardlink for files; `cpSync` only as last resort |
| 9 | `--no-orchestrator` start opened `/sessions/undefined` | Guard `selectedOrchestratorId` and fall back to base URL |
| 10 | No desktop notifications on Windows | WinRT toast via PowerShell `-EncodedCommand` (no third-party deps); soft-fail on stripped SKUs |
| 11 | xterm last-column stripe after monitor DPI change | `matchMedia('(resolution: …dppx)')` listener triggers re-fit |

### Other Windows-specific fixes shipped along the way

- `gh.exe` / `gh.cmd` resolution in `gh-trace.ts` honoring `PATHEXT`
- Codex JSONL path normalization (`toComparablePath`) so session lookup matches across `D:/` vs `D:\` and case variations
- ConPTY input chunking (~512-char frames with delays) — Windows ConPTY truncates ~3-4 KB writes
- USERPROFILE-isolated test setup, normalized path assertions in `*.test.ts`
- pty-host keep-alive + graceful shutdown
- Process-runtime `restore()` now rewrites the nested `statePayload.runtime.handle` (was only patching the top-level)
- `pwsh` preferred over `powershell.exe`, `cmd.exe` last resort
- Atomic write retry on EBUSY (AV / Search Indexer)

### Tests

Vitest covers Windows code paths via `mockIsWindows`. `pickCallback` helper in `platform.mock.test.ts` accepts both 3-arg and 4-arg `execFile` signatures so call-site changes (adding `windowsHide`) don't shatter mocks. Integration tests in `packages/integration-tests` mirror this pattern.

---

## Deferred (waiting on upstream)

**Stop fix.** Terminal blink + occasional collateral damage in `ao stop` traced to the unconditional parent-kill in `cli/commands/start.ts`. Upstream [PR #1496](https://github.com/ComposioHQ/agent-orchestrator/pull/1496) addresses this; we built the same patch locally for live testing, then dropped it to avoid a merge conflict when #1496 lands. Re-apply (or just take the upstream merge) once #1496 is in main.

---

## Out of scope

- ISSUE-022, ISSUE-026 — could not reproduce on Linux to write a regression test; re-check after Windows soak.
- Self-healing for orphaned sessions (named pipe gone, metadata still around) — explicitly skipped this round.
- Cross-platform pre-existing test failures on `main` (filesystem-browse, two API-routes tests, Dashboard.doneBar, serialize) — not Windows-related; verified by checking out `main`.
