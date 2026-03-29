# Code Quality Audit Report — `packages/cli/`

## Executive Summary
- **Overall Score**: 618/1000
- **Maintainability Verdict**: Requires Refactoring
- **Primary Strengths**: Clean command/lib separation, consistent plugin architecture, good TypeScript usage, well-designed session management abstraction
- **Critical Weaknesses**: `start.ts` is a 1,296-line monolith with deeply nested control flow; installation helpers repeat the same pattern 4 times; silent `.catch(() => null)` blocks make production debugging difficult; ~40% of library files lack unit tests

## File/Component Scores

| File/Path | Score /100 | Assessment |
|-----------|------------|------------|
| `src/index.ts` (51 lines) | 92 | Clean entry point; commander registration is flat and obvious |
| `src/commands/init.ts` (18 lines) | 90 | Trivial wrapper, correctly deprecated |
| `src/commands/update.ts` (28 lines) | 88 | Simple delegation to shell script |
| `src/commands/open.ts` (75 lines) | 80 | Clear logic, but iTerm failure silently swallowed |
| `src/lib/format.ts` (122 lines) | 85 | Well-organized formatters; `padCol` ANSI handling is correct |
| `src/lib/shell.ts` (61 lines) | 84 | Focused wrappers; 10MB buffer limit is sensible |
| `src/lib/session-utils.ts` (50 lines) | 85 | Small, well-focused utilities |
| `src/lib/caller-context.ts` (22 lines) | 88 | Trivial, correct |
| `src/lib/plugins.ts` (52 lines) | 76 | Functional but brittle: hard-coded plugin map must be maintained manually |
| `src/lib/detect-agent.ts` (97 lines) | 74 | Hard-coded AGENT_PLUGINS list; silent swallow of import errors |
| `src/lib/git-utils.ts` (49 lines) | 82 | Good 3-tier fallback for default branch detection |
| `src/lib/detect-env.ts` (69 lines) | 80 | Straightforward environment probes |
| `src/lib/preflight.ts` (113 lines) | 78 | Good error messages but `findPackageUp` reimplements module resolution |
| `src/lib/openclaw-probe.ts` (128 lines) | 76 | Functional; fragile string-matching for error classification (lines 44-48) |
| `src/lib/config-instruction.ts` (133 lines) | 80 | Static reference data, well-organized |
| `src/lib/project-detection.ts` (239 lines) | 70 | Repetitive `pkg?.dependencies?.X \|\| pkg?.devDependencies?.X` pattern (lines 47-58); `readFileSync` called multiple times without caching; `readJson` silently eats parse errors |
| `src/lib/web-dir.ts` (188 lines) | 72 | Port scanning logic is correct but undocumented magic ports (14800); `findAvailablePortPair` falls back silently to base port on exhaustion (line 100) |
| `src/lib/running-state.ts` (161 lines) | 73 | Lock design is sound but `process.kill(pid, 0)` has cross-platform edge cases; 5s stale timeout may be aggressive |
| `src/lib/dashboard-rebuild.ts` (74 lines) | 68 | `lsof` output parsing (line 34-40) is fragile index-based logic; platform-dependent |
| `src/lib/lifecycle-service.ts` (255 lines) | 71 | PID file TOCTOU window exists despite mitigation (lines 199-204); SIGTERM→SIGKILL escalation is correct |
| `src/lib/create-session-manager.ts` (63 lines) | 78 | Clean factory; caches at promise level |
| `src/lib/script-runner.ts` (54 lines) | 78 | Simple delegation |
| `src/commands/doctor.ts` (221 lines) | 72 | Hardcoded mock notification data (lines 144-152); partial probe coverage (only OpenClaw fully probed) |
| `src/commands/verify.ts` (178 lines) | 70 | Hardcoded label strings scattered ("merged-unverified", "verified", "verification-failed"); inconsistent `process.exit` usage |
| `src/commands/review-check.ts` (152 lines) | 73 | Hardcoded DEFAULT_REVIEW_FIX_PROMPT duplicated from config defaults; silent skip on parse failures |
| `src/commands/lifecycle-worker.ts` (139 lines) | 72 | Manual stdio flushing logic (lines 74-86) should use promises; hardcoded intervals |
| `src/commands/dashboard.ts` (125 lines) | 70 | `looksLikeStaleBuild()` uses 5 hardcoded string patterns — fragile; buffer stores up to 100 stderr chunks without bound |
| `src/commands/send.ts` (214 lines) | 68 | Magic numbers throughout (5s poll, 300ms sleep, 2s retry, 10-line capture); `captureOutput` closure defined but only used locally |
| `src/commands/session.ts` (327 lines) | 66 | `filterCleanupIds` and `filterCleanupErrors` (lines 149-163) are near-identical but not consolidated; inconsistent error handling (some throw, some `process.exit`) |
| `src/commands/setup.ts` (531 lines) | 67 | `interactiveSetup()` is 120+ lines with deep nesting and 6 identical `clack.cancel()`→`throw` sequences; shell regex at line 353 needs better documentation |
| `src/commands/status.ts` (414 lines) | 64 | `gatherSessionInfo()` mixes SCM, agent introspection, and tmux querying; 5 `.catch(() => null)` blocks make failures invisible |
| `src/commands/spawn.ts` (406 lines) | 67 | Duplicated `autoDetectProject` error handling (lines 202-216 repeat the same try/catch pattern); `setTimeout(r, 500)` between spawns is a magic delay |
| `src/commands/start.ts` (1,296 lines) | 48 | Monolithic file with 5+ responsibilities; `registerStart.action()` is 180 lines of nested if/else; installation patterns repeated for git/tmux/gh/agents; magic numbers everywhere |

## Detailed Findings

### Complexity & Duplication

**start.ts is the primary complexity hotspot.**

At 1,296 lines, `start.ts` handles config loading, URL parsing, repo cloning, interactive project selection, dependency installation (git, tmux, gh, agent runtimes), dashboard spawning, lifecycle worker management, orchestrator session creation, running state registration, and stop functionality. The `registerStart.action()` handler alone (lines 1014-1193) is a 180-line method with 4+ levels of nesting:

```typescript
// start.ts:1028-1093 — three-branch conditional, each with nested try/catch
if (projectArg && isRepoUrl(projectArg)) {
  // URL branch
} else if (projectArg && isLocalPath(projectArg)) {
  if (!configPath) {
    if (resolve(cwd()) !== resolvedPath) { ... } else { ... }
  } else {
    const existingEntry = Object.entries(config.projects).find(...);
    if (existingEntry) { ... } else { ... }
  }
} else {
  // Default branch with its own try/catch
}
```

**Installation helper duplication.** The pattern of "check if installed → prompt to install → try installers → verify → show hints on failure" is repeated four times:

- `ensureGit()` (lines 276-299)
- `ensureTmux()` (lines 783-807)
- `promptInstallAgentRuntime()` (lines 336-376)
- Implicit gh install in `autoCreateConfig()` (lines 580-593)

Each follows the same structure but with different binaries and install commands. This should be one generic function.

**session.ts filter duplication.** `filterCleanupIds` (line 149) and `filterCleanupErrors` (line 157) share identical parsing logic for extracting projectId and sessionId from colon-separated entries:

```typescript
const separator = entry.indexOf(":");
const entryProjectId = separator === -1 ? opts.project : entry.slice(0, separator);
const sessionId = separator === -1 ? entry : entry.slice(separator + 1);
```

This parsing appears twice with only the surrounding filter callback differing.

**project-detection.ts repetitive dependency checks.** Lines 47-58 repeat `pkg?.dependencies?.X || pkg?.devDependencies?.X` six times. A helper like `hasDep(pkg, name)` would reduce noise.

### Style & Convention Adherence

**Naming is generally consistent.** Functions use camelCase, interfaces use PascalCase, constants use UPPER_SNAKE_CASE. The `register*` pattern for command registration is used uniformly across all command files.

**Import style is correct.** ESM imports with `.js` extensions and `node:` prefix for builtins are used consistently, matching the project rules.

**Inconsistent error exit patterns.** Some commands throw errors that bubble up to a top-level catch (`start.ts`), while others call `process.exit(1)` directly mid-function (`spawn.ts` lines 193, 206-207, 213-214; `session.ts` lines 23-24, 91-93). The `verify.ts` command mixes both in the same file. This makes control flow unpredictable and testing harder.

**`eslint-disable` comment.** `setup.ts` line 228 has `// eslint-disable-next-line @typescript-eslint/no-explicit-any` for a YAML document cast. This is the only `any` in the CLI package, and it's necessary for YAML interop — acceptable but worth noting.

### Readability & Maintainability

**Silent failures erode debuggability.** The following pattern appears 12+ times across the CLI:

```typescript
} catch {
  // Not critical
}
```

Notable instances:
- `status.ts` lines 76-78, 106-108, 116-118, 346-348, 358-360 — five catch blocks that swallow SCM, agent introspection, and tracker errors
- `send.ts` line 144-146 — terminal tab open failure
- `spawn.ts` line 376-378 — terminal tab open failure
- `session.ts` line 101-103 — cleanup failures

While graceful degradation is the right UX choice, these should log at debug/trace level so operators can diagnose issues. A `debugLog()` wrapper would add zero user-visible noise while enabling troubleshooting.

**Magic numbers.** Hardcoded values without named constants:

| Value | Location | Purpose |
|-------|----------|---------|
| `3000` | `start.ts:61` | Default dashboard port |
| `14800` | `web-dir.ts:18` | Default terminal port |
| `100` | `web-dir.ts:41` | Max port scan range |
| `50` | `web-dir.ts:90` | Max port pair attempts |
| `300` | `web-dir.ts:32` | Socket timeout ms |
| `5000` | `send.ts:172` | Poll interval ms |
| `600` | `send.ts:121` | Default send timeout sec |
| `2000` | `send.ts:195` | Retry delay ms |
| `500` | `spawn.ts:279` | Inter-spawn delay ms |
| `5000` | `running-state.ts:49` | Lock timeout ms |
| `5000` | `lifecycle-service.ts:17` | Start timeout ms |
| `100` | `dashboard.ts:69` | Max stderr chunks |

**start.ts's interactive menu (lines 1104-1163)** uses raw readline with numbered choices. This inline UI logic inflates the file and mixes concerns. The same interaction pattern (numbered list → parse int → branch) is also in `detect-agent.ts` and `promptInstallAgentRuntime()`.

### Performance Anti-patterns

**No significant algorithmic issues.** Most operations are I/O-bound (shell commands, file reads, network probes).

**Sequential port scanning.** `findFreePort()` checks ports one at a time (line 49). For the common case (first few ports free), this is fine. But in congested environments, scanning 100 ports sequentially with 300ms socket timeouts could take 30 seconds. A batched approach (e.g., 10 concurrent checks) would improve worst-case latency.

**Repeated `readFileSync` in project-detection.ts.** Lines 98-108 read `requirements.txt` and `pyproject.toml` with `readFileSync` inside a loop, even though `readJson("package.json")` was already called above. Each file read is synchronous and blocking. For a detection utility called once at setup time, this is acceptable but not ideal.

**`gatherSessionInfo()` in status.ts** makes parallel SCM calls per session (`Promise.all` at line 105), but the outer loop (line 278) calls `Promise.all` on all sessions. This means N sessions result in N parallel SCM queries, which could hit GitHub API rate limits for large deployments.

### Security & Error Handling

**Shell injection protection is good.** `setup.ts` line 346 escapes single quotes in tokens before writing to shell profiles:

```typescript
const safeToken = token.replace(/'/g, "'\\''");
const exportLine = `export OPENCLAW_HOOKS_TOKEN='${safeToken}'`;
```

This is the correct shell escaping technique.

**Token handling.** The env-var placeholder pattern in `setup.ts` (line 239) avoids committing raw tokens to YAML config:

```typescript
token: "$" + "{OPENCLAW_HOOKS_TOKEN}", // env-var placeholder, not a JS template
```

This is well-designed.

**No command injection vectors found.** All external command invocations use `execFile` (not `exec` with shell interpretation), which prevents command injection through user-supplied arguments.

**Error cause chaining is partially adopted.** `spawn.ts` line 120 and `start.ts` lines 452, 887, 915 use `{ cause: err }` — good. But many other catch blocks discard the original error:

```typescript
// session.ts:127 — loses original error details
console.error(chalk.red(`Failed to kill session ${sessionName}: ${err}`));
```

String interpolation of `err` produces `[object Object]` for non-Error types. Should use `err instanceof Error ? err.message : String(err)`.

**`process.exit()` bypasses cleanup.** Several commands call `process.exit(1)` directly instead of throwing, which skips any pending I/O, open handles, or cleanup logic. In particular, `send.ts` line 73 exits mid-function before the tmux session check completes.

## Final Verdict

The CLI package is **functionally solid** — it correctly manages sessions, handles interactive and non-interactive flows, and has reasonable type safety. The plugin architecture is clean and the command registration pattern is consistent.

However, **`start.ts` is a critical maintainability bottleneck** at nearly 1,300 lines. It combines 5+ responsibilities (config management, dependency installation, dashboard lifecycle, orchestrator setup, running state tracking) that should be separate modules. The repeated installation helper pattern, silent error swallowing, and scattered magic numbers compound the issue.

Test coverage is estimated at ~55% (20 test files covering 33 source files), with critical gaps in lifecycle management, process state tracking, and detection utilities.

**Recommendation**: Refactor `start.ts` into 3-4 focused modules, extract the installation helper pattern into a reusable function, add debug-level logging to silent catch blocks, and write unit tests for the untested library files. These changes would raise the overall score to 700+ without changing any user-facing behavior.
