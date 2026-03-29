# Code Quality Audit Report

## Executive Summary
- **Overall Score**: 648/1000
- **Maintainability Verdict**: Requires Refactoring
- **Primary Strengths**: Consistent plugin architecture, strong security awareness (input validation, shell escaping, path traversal prevention), streaming for large files, comprehensive test suites
- **Critical Weaknesses**: Massive code duplication across agent plugins (~200 LOC of `isProcessRunning` + `normalizePermissionMode` copy-pasted 4x), embedded bash scripts in template literals (unmaintainable, untestable as isolated units), version mismatches between package.json and manifest, two agent plugins ship stub implementations

## File/Component Scores
| File/Path | Score /100 | Assessment |
|-----------|------------|------------|
| `agent-codex/src/index.ts` | 62 | Functional but overloaded — 887 lines mixing shell scripts, JSONL streaming, binary resolution, and agent logic in one file |
| `agent-codex/src/app-server-client.ts` | 82 | Clean JSON-RPC client with proper lifecycle management, good event patterns |
| `agent-codex/src/index.test.ts` | 75 | Thorough coverage but shares duplicated helper patterns with other test files |
| `agent-codex/src/app-server-client.test.ts` | 85 | Excellent coverage including edge cases, concurrency guards, and resource cleanup |
| `agent-claude-code/src/index.ts` | 60 | 868 lines, large embedded bash script, duplicated process detection logic, multiple responsibilities |
| `agent-claude-code/src/index.test.ts` | 78 | Well-structured with thorough JSONL parsing tests, but helpers duplicated |
| `agent-claude-code/src/__tests__/activity-detection.test.ts` | 88 | Excellent integration tests using real filesystem, clean setup/teardown |
| `agent-opencode/src/index.ts` | 55 | Complex inline shell script generation with embedded Node.js, stub `getSessionInfo`/`detectActivity` |
| `agent-opencode/src/index.test.ts` | 72 | Good coverage for launch commands, duplicated helpers |
| `agent-aider/src/index.ts` | 68 | Cleanest agent impl, but duplicates process detection logic and has stub `detectActivity` |
| `agent-aider/src/index.test.ts` | 70 | Adequate coverage, duplicated helpers |
| `runtime-process/src/index.ts` | 80 | Solid process management with per-instance isolation, process group kills, proper cleanup |
| `runtime-process/src/__tests__/index.test.ts` | 78 | Good test coverage |
| `runtime-tmux/src/index.ts` | 76 | Smart use of load-buffer/paste-buffer for long commands, but uses sync fs ops |
| `runtime-tmux/src/__tests__/index.test.ts` | 72 | Adequate coverage |
| `workspace-worktree/src/index.ts` | 74 | Good security (path validation, symlink checking), duplicates code with workspace-clone |
| `workspace-worktree/src/__tests__/index.test.ts` | 70 | Basic coverage |
| `workspace-clone/src/index.ts` | 72 | Solid clone-with-reference approach, duplicates code with workspace-worktree |
| `workspace-clone/src/__tests__/index.test.ts` | 68 | Basic coverage |
| `terminal-iterm2/src/index.ts` | 75 | Clean AppleScript integration, proper double-escaping |
| `terminal-iterm2/src/index.test.ts` | 72 | Adequate |
| `terminal-web/src/index.ts` | 82 | Minimal and clean, appropriate for its role |
| `terminal-web/src/index.test.ts` | 74 | Good coverage for a simple plugin |

## Detailed Findings

### Complexity & Duplication

**CRITICAL: `isProcessRunning` duplicated across all 4 agent plugins (lines ~160-210 in each)**

The tmux pane TTY lookup + `ps` parsing + PID signal-check logic is nearly character-identical across `agent-codex/src/index.ts:720-769`, `agent-claude-code/src/index.ts:468-524` (via `findClaudeProcess`), `agent-opencode/src/index.ts:296-345`, and `agent-aider/src/index.ts:160-208`. The only difference is the process name regex (`/codex/`, `/claude/`, `/opencode/`, `/aider/`). This is approximately 200 lines duplicated 4 times = ~600 lines of waste.

```typescript
// All four plugins contain this near-identical block:
if (handle.runtimeName === "tmux" && handle.id) {
  const { stdout: ttyOut } = await execFileAsync("tmux", ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"], ...);
  // ... same TTY parsing ...
  const processRe = /(?:^|\/)AGENT_NAME(?:\s|$)/;  // only this regex differs
  // ... same ps parsing ...
}
const rawPid = handle.data["pid"];
// ... same PID check with EPERM handling ...
```

**`normalizePermissionMode` duplicated 3x** — `agent-codex/src/index.ts:27-34`, `agent-claude-code/src/index.ts:26-33`, `agent-aider/src/index.ts:21-28`. Identical function bodies.

**Test helpers duplicated 4x** — `makeSession`, `makeTmuxHandle`, `makeProcessHandle`, `makeLaunchConfig`, `mockTmuxWithProcess` are copy-pasted across all four agent test files with minor variations.

**Workspace plugins share duplicated code** — `assertSafePathSegment`, `SAFE_PATH_SEGMENT`, `expandPath`, and the `git()` helper are identical between `workspace-worktree/src/index.ts` and `workspace-clone/src/index.ts`.

**Monolith files** — `agent-codex/src/index.ts` (887 lines) and `agent-claude-code/src/index.ts` (868 lines) each combine:
- Shell wrapper scripts (bash in JS template literals)
- JSONL session file parsing
- Binary resolution / process detection
- Agent interface implementation
- Workspace setup hooks

These should be decomposed into focused modules.

### Style & Convention Adherence

**Version mismatch across all plugins** — Every plugin's `package.json` declares `"version": "0.2.0"` but the `manifest` object inside the source code declares different versions:
- `agent-codex`: manifest says `0.1.1`, package.json says `0.2.0`
- `agent-claude-code`: manifest says `0.1.0`, package.json says `0.2.0`
- `agent-opencode`: manifest says `0.1.0`, package.json says `0.2.0`
- `agent-aider`: manifest says `0.1.0`, package.json says `0.2.0`
- All runtime/workspace/terminal plugins: manifest says `0.1.0`, package.json says `0.2.0`

This is confirmed by `agent-codex/src/package-version.test.ts` which asserts the package version is `0.2.0`, but the manifest hardcodes `0.1.1`.

**Inconsistent timeout values** across the codebase:
- `runtime-tmux`: `TMUX_COMMAND_TIMEOUT_MS = 5_000`
- Agent `isProcessRunning` tmux calls: `timeout: 30_000` (6x longer for the same operation)
- Agent `isProcessRunning` ps calls: `timeout: 30_000` in codex/opencode/aider, but claude-code uses `timeout: 5_000` via cached ps
- `workspace-worktree`: `GIT_TIMEOUT = 30_000` (declared but only used in `exists()`, not in the `git()` helper)

**Mixed `catch` patterns** — Some `catch` blocks include explanatory comments (`// Session may already be dead`), while many are bare `catch {}`. The bare catches suppress potentially actionable errors (e.g., `workspace-worktree/src/index.ts:131` catches git worktree remove failure and falls back to `rmSync`, which could mask the root cause).

**Sync vs async fs inconsistency** — `runtime-tmux` uses `writeFileSync`/`unlinkSync` for temp files inside an otherwise fully async flow. `workspace-worktree` and `workspace-clone` use sync `existsSync`, `readdirSync`, `mkdirSync`, `lstatSync`, `symlinkSync`, `rmSync` mixed with async git commands.

### Readability & Maintainability

**Embedded bash scripts in template literals** are the largest readability issue:
- `agent-codex/src/index.ts:84-241` — 158 lines of bash (`AO_METADATA_HELPER`, `GH_WRAPPER`, `GIT_WRAPPER`)
- `agent-claude-code/src/index.ts:41-192` — 152 lines of bash (`METADATA_UPDATER_SCRIPT`)

These scripts:
- Cannot be linted by shellcheck
- Cannot be tested independently (the claude-code tests check string content but don't execute the script in isolation)
- Are hard to edit due to `\$` escaping within JS template literals
- Have their own `eslint-disable` comments to suppress false positives

**agent-opencode `getLaunchCommand`** generates a multi-statement shell pipeline (lines 197-217) with *two inline Node.js scripts* (`buildSessionIdCaptureScript` and `buildSessionLookupScript`). These scripts are minified into single-line strings via `.replace(/\n/g, " ")`, making them impossible to read when debugging. The launch command output is effectively a 3-stage shell pipeline that creates a session, captures its ID, and then re-attaches — all as a single shell string.

**Implicit behavior: Claude Code `promptDelivery: "post-launch"`** — Only `agent-claude-code` sets `promptDelivery: "post-launch"` (line 657), meaning prompts are sent after the agent launches rather than as CLI arguments. This is a critical architectural difference but is not documented in the code beyond a comment on lines 682-684.

### Performance Anti-patterns

**agent-claude-code `parseJsonlFileTail`** reads up to 128 KB from the file tail and parses every line into objects, even though `getSessionInfo` only needs the *last* summary entry and aggregate cost. For files near the 128 KB boundary, this creates thousands of unnecessary JSON.parse calls. The function at `agent-claude-code/src/index.ts:290-333` could short-circuit when it finds a summary entry from the end.

**agent-codex `collectJsonlFiles`** at line 363 is sequential — it `readdir`s and `lstat`s each entry one at a time. For date-sharded directories (YYYY/MM/DD), this means 4 levels of sequential readdir. Parallelizing with `Promise.all` on the subdirectories would improve latency.

**agent-codex `findCodexSessionFile`** at line 446 reads the first 4 KB of *every* JSONL file sequentially to check `session_meta` before moving on. With many session files, this creates significant I/O latency. The files are date-sharded, so sorting by directory name (newest first) and stopping early would be more efficient.

**No `ps` caching in codex/opencode/aider** — `agent-claude-code` implements a `ps` cache (`getCachedProcessList()` at line 429) to avoid N concurrent `ps` calls when enriching N sessions. The other three agents (`agent-codex`, `agent-opencode`, `agent-aider`) do not have this optimization and will spawn a separate `ps` process per session check.

### Security & Error Handling

**Positive security patterns (worth noting)**:
- `SAFE_SESSION_ID` regex validation in runtime-process and runtime-tmux (lines 19-25 in each)
- `SAFE_PATH_SEGMENT` in workspace plugins prevents directory traversal
- `atomicWriteFile` in agent-codex prevents partial-read races
- Path traversal prevention in `AO_METADATA_HELPER` bash script (codex, lines 95-112)
- Symlink target validation in workspace-worktree `postCreate` (lines 255-270)
- Session ID validation for OpenCode (`asValidOpenCodeSessionId`) prevents injection

**`shell: true` in runtime-process** — `runtime-process/src/index.ts:68` uses `shell: true` for spawn. The comment says "launchCommand comes from trusted YAML config", but this is a trust boundary that should be documented at the plugin interface level, not just in an inline comment.

**`sh -c command` in workspace plugins** — Both `workspace-worktree/src/index.ts:294` and `workspace-clone/src/index.ts:237` execute `postCreate` hooks via `execFileAsync("sh", ["-c", command])`. Same trust assumption, same lack of interface-level documentation.

**Unescaped session names in runtime-tmux** — `runtime-tmux/src/index.ts:59` passes `sessionName` directly to tmux commands without escaping for tmux special characters. The `SAFE_SESSION_ID` regex from the runtime-process plugin is also present in runtime-tmux (line 28), which mitigates this, but the protection relies on the caller (not the tmux command itself).

**`console.log`/`console.warn` in production code** — `terminal-web/src/index.ts:32-43` uses `console.log` for session URLs. `workspace-clone/src/index.ts:154` uses `console.warn` for corrupted clones. These should use a structured logger.

## Final Verdict

The plugin architecture is well-designed and consistent — every plugin follows the same manifest/create/detect pattern, and the type system enforces correct interfaces. Security is treated seriously with multiple layers of input validation.

However, the codebase suffers from significant DRY violations. The `isProcessRunning` and `normalizePermissionMode` duplication across all agent plugins is the most egregious issue — any bug fix or behavior change must be applied in 4 places. The embedded bash scripts compound this by being opaque to standard tooling.

The two largest files (`agent-codex` and `agent-claude-code`) exceed 800 lines and combine 4-5 distinct responsibilities, making them difficult to navigate and modify. The OpenCode launch command generator is particularly fragile due to inline minified Node.js scripts.

**Major refactoring is needed** to extract shared logic into `@composio/ao-core` (or a shared plugin utilities module), decompose the monolith agent files, and externalize embedded bash scripts into proper `.sh` files.
