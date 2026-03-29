# Refactoring Improvements Roadmap

## Critical Refactors

### Refactor: Extract shared `isProcessRunning` into `@composio/ao-core`
- **Location**: `agent-codex/src/index.ts:720-769`, `agent-claude-code/src/index.ts:468-524`, `agent-opencode/src/index.ts:296-345`, `agent-aider/src/index.ts:160-208`
- **Problem**: The tmux pane TTY lookup + `ps` parsing + PID signal-check logic is duplicated nearly identically across all 4 agent plugins (~200 LOC x 4 = ~600 wasted lines). The only difference is the process name regex. A bug fix or behavioral change must be applied in 4 places, which is error-prone and has already led to inconsistencies (e.g., claude-code has `ps` caching while the other three do not).
- **Impact**: Any future agent plugin must copy this boilerplate. The lack of `ps` caching in codex/opencode/aider means N concurrent `ps` processes when checking N sessions — a production performance issue.
- **Suggested Approach**: Create a shared function in `@composio/ao-core`:
  ```typescript
  // @composio/ao-core/src/process-detection.ts
  export async function isAgentProcessRunning(
    handle: RuntimeHandle,
    processName: string,
    options?: { psCacheTtlMs?: number }
  ): Promise<boolean>
  ```
  Each agent plugin reduces to:
  ```typescript
  async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
    return isAgentProcessRunning(handle, "codex");
  }
  ```
  Move the `ps` cache from `agent-claude-code` into the shared implementation so all agents benefit.

### Refactor: Extract `normalizePermissionMode` into `@composio/ao-core`
- **Location**: `agent-codex/src/index.ts:27-34`, `agent-claude-code/src/index.ts:26-33`, `agent-aider/src/index.ts:21-28`
- **Problem**: Identical function body copy-pasted in 3 files. If a new permission mode is added or the "skip" → "permissionless" mapping changes, all 3 must be updated.
- **Impact**: Medium — small function, but it's a policy decision that should have a single source of truth.
- **Suggested Approach**: Export from `@composio/ao-core`:
  ```typescript
  export function normalizePermissionMode(mode: string | undefined): PermissionMode | undefined;
  ```

### Refactor: Externalize embedded bash scripts into `.sh` files
- **Location**: `agent-codex/src/index.ts:84-241` (3 scripts, 158 lines), `agent-claude-code/src/index.ts:41-192` (1 script, 152 lines)
- **Problem**: ~310 lines of bash embedded in JS template literals cannot be:
  - Linted by shellcheck
  - Tested as standalone scripts
  - Edited without navigating JS escape sequences (`\$`, `\\\\'`, etc.)
  - Reviewed by developers who don't understand the JS escaping layer

  The codex file has an `eslint-disable` block specifically for this. The claude-code test file (`index.test.ts:698-756`) tests the script by checking string content rather than execution, which is fragile.
- **Impact**: These scripts handle metadata updates for session tracking. A bash syntax error introduced during editing would silently break metadata collection without any compile-time signal.
- **Suggested Approach**:
  1. Move each script to a `.sh` file alongside the source (e.g., `agent-codex/src/scripts/gh-wrapper.sh`)
  2. Bundle them at build time using a simple build step that reads the file and exports as a constant
  3. Or read them at runtime from a known location (the scripts are already written to `~/.ao/bin/` at runtime)
  4. Add shellcheck to CI for the `.sh` files

### Refactor: Fix version mismatches between package.json and manifest
- **Location**: All 10 plugin directories — every `manifest.version` differs from `package.json` `"version"`
- **Problem**: `package.json` says `0.2.0` everywhere, but manifest objects say `0.1.0` or `0.1.1`. The codex `app-server-client.ts:383` also hardcodes `version: "0.1.1"`. Consumers relying on the manifest version see stale values.
- **Impact**: Version confusion in production. If the plugin loader uses manifest version for compatibility checks or caching, it will use wrong values.
- **Suggested Approach**: Either:
  1. Auto-generate manifest version from `package.json` at build time
  2. Or import `version` from a generated constants file: `import { VERSION } from "./generated/version.js"`

  The existing `package-version.test.ts` in agent-codex should be extended to verify `manifest.version === packageJson.version`.

## Medium Priority Improvements

### Refactor: Extract shared workspace utilities
- **Location**: `workspace-worktree/src/index.ts:27-47`, `workspace-clone/src/index.ts:24-44`
- **Problem**: `assertSafePathSegment`, `SAFE_PATH_SEGMENT`, `expandPath`, and the `git()` helper are duplicated between the two workspace plugins. Both also have identical `postCreate` hook execution logic.
- **Impact**: Any change to path validation rules must be applied in both files.
- **Suggested Approach**: Create `@composio/ao-core/src/workspace-utils.ts` with:
  ```typescript
  export function assertSafePathSegment(value: string, label: string): void;
  export function expandPath(p: string): string;
  export function git(cwd: string, ...args: string[]): Promise<string>;
  export async function runPostCreateHooks(info: WorkspaceInfo, project: ProjectConfig): Promise<void>;
  ```

### Refactor: Extract shared test helpers
- **Location**: All 4 agent test files: `agent-codex/src/index.test.ts`, `agent-claude-code/src/index.test.ts`, `agent-opencode/src/index.test.ts`, `agent-aider/src/index.test.ts`
- **Problem**: `makeSession`, `makeTmuxHandle`, `makeProcessHandle`, `makeLaunchConfig`, and `mockTmuxWithProcess` are duplicated across all test files with only minor variations (e.g., the process name in `mockTmuxWithProcess`).
- **Impact**: Adding a new field to `Session` type requires updating 4 test files. Test patterns diverge over time — some helpers are slightly more complete than others.
- **Suggested Approach**: Create a shared test utilities package or file:
  ```typescript
  // packages/plugins/test-utils/src/index.ts
  export function makeSession(overrides?: Partial<Session>): Session;
  export function makeTmuxHandle(id?: string): RuntimeHandle;
  export function makeProcessHandle(pid?: number): RuntimeHandle;
  export function makeLaunchConfig(overrides?: Partial<AgentLaunchConfig>): AgentLaunchConfig;
  export function mockTmuxWithProcess(mockFn: Mock, processName: string, ...): void;
  ```

### Refactor: Decompose monolith agent files
- **Location**: `agent-codex/src/index.ts` (887 lines), `agent-claude-code/src/index.ts` (868 lines)
- **Problem**: Each file combines 4-5 distinct responsibilities: shell scripts, JSONL parsing, binary/process detection, workspace setup, and the actual Agent interface implementation. This makes it hard to navigate and creates merge conflicts when multiple developers touch different concerns.
- **Impact**: High cognitive load for developers. Adding a new JSONL field requires scrolling past 200 lines of bash.
- **Suggested Approach**: Split each into focused modules:
  ```
  agent-codex/src/
    index.ts          # Agent impl + exports (create, detect, manifest)
    jsonl.ts          # Session file discovery + streaming
    binary.ts         # resolveCodexBinary
    workspace.ts      # setupCodexWorkspace + shell wrapper logic
  ```
  Same pattern for claude-code:
  ```
  agent-claude-code/src/
    index.ts          # Agent impl + exports
    jsonl.ts          # Session file parsing + summary/cost extraction
    hooks.ts          # Hook setup + metadata updater script
    process.ts        # Process detection (or use shared from core)
  ```

### Refactor: Simplify agent-opencode launch command generation
- **Location**: `agent-opencode/src/index.ts:161-227`
- **Problem**: `getLaunchCommand` generates a 3-stage shell pipeline with two inline minified Node.js scripts (`buildSessionIdCaptureScript` at line 70 and `buildSessionLookupScript` at line 108). These scripts are compressed via `.replace(/\n/g, " ")` and passed as arguments to `node -e`. The resulting launch command is ~500 chars of unreadable shell.
- **Impact**: Debugging launch failures requires mentally un-minifying the Node.js scripts. Any change to the session discovery logic requires modifying string-building code.
- **Suggested Approach**:
  1. Write the Node.js scripts as actual `.js` files in the package
  2. Reference them via `node /path/to/session-capture.js` instead of inlining
  3. Or better: extract the session discovery into a TypeScript function that runs before launching OpenCode, rather than generating a shell command that does discovery at launch time

### Refactor: Standardize timeout constants
- **Location**: Various — `runtime-tmux/src/index.ts:18`, agent plugins (hardcoded in calls), `workspace-worktree/src/index.ts:14`
- **Problem**: Timeout values for the same operations vary wildly:
  - tmux commands: 5s in runtime-tmux, 30s in agent `isProcessRunning`
  - `ps` commands: 30s in codex/opencode/aider, 5s in claude-code
  - git commands: 30s declared as `GIT_TIMEOUT` but only used in one place
- **Impact**: Inconsistent behavior under load. A tmux operation that times out in 5s at the runtime layer but is given 30s at the agent layer creates confusing failure modes.
- **Suggested Approach**: Define standard timeouts in `@composio/ao-core`:
  ```typescript
  export const TIMEOUTS = {
    TMUX_COMMAND_MS: 10_000,
    PS_COMMAND_MS: 10_000,
    GIT_COMMAND_MS: 30_000,
    BINARY_RESOLUTION_MS: 10_000,
  } as const;
  ```

### Refactor: Add `ps` cache to all agent plugins (or extract to shared)
- **Location**: `agent-claude-code/src/index.ts:421-462` has the cache; `agent-codex/src/index.ts:735`, `agent-opencode/src/index.ts:311`, `agent-aider/src/index.ts:175` do not
- **Problem**: When checking activity for N sessions, the agents without caching spawn N separate `ps -eo pid,tty,args` processes. On machines with many processes, each `ps` call takes 30+ seconds.
- **Impact**: Dashboard refresh latency scales linearly with session count for codex/opencode/aider agents.
- **Suggested Approach**: This is resolved automatically if `isProcessRunning` is extracted to a shared implementation (see Critical Refactors above). The shared implementation should include the cache.

## Nice-to-Have Enhancements

### Enhancement: Replace sync fs operations with async equivalents
- **Location**: `runtime-tmux/src/index.ts:5` (`writeFileSync`, `unlinkSync`), `workspace-worktree/src/index.ts:3` (`existsSync`, `lstatSync`, `symlinkSync`, `rmSync`, `mkdirSync`, `readdirSync`), `workspace-clone/src/index.ts:3` (`existsSync`, `rmSync`, `mkdirSync`, `readdirSync`)
- **Description**: These files use synchronous fs operations within otherwise async workflows. While the impact is small for individual calls, they block the event loop during I/O, which matters when processing multiple sessions concurrently.
- **Benefit**: Consistent async style, better event loop utilization under concurrent load.
- **Suggested Approach**: Replace `writeFileSync` with `writeFile`, `existsSync` with `stat` wrapped in try/catch, etc. The workspace plugins can use `fs/promises` for directory operations.

### Enhancement: Replace `console.log`/`console.warn` with structured logger
- **Location**: `terminal-web/src/index.ts:32-43`, `workspace-clone/src/index.ts:154`, `terminal-iterm2/src/index.ts:139`
- **Description**: Production code uses `console.log` for informational output and `console.warn` for diagnostics. These cannot be filtered, structured, or routed to monitoring.
- **Benefit**: Consistent logging, ability to suppress noisy output, integration with observability tooling.
- **Suggested Approach**: Accept a logger interface in plugin `create()` options, or use a shared logger from `@composio/ao-core`.

### Enhancement: Implement `getSessionInfo` for opencode and aider
- **Location**: `agent-opencode/src/index.ts:347-350`, `agent-aider/src/index.ts:211-214`
- **Description**: Both return `null` unconditionally. OpenCode has a session list API that could provide title/timestamp. Aider has `.aider.chat.history.md` that could provide a summary.
- **Benefit**: Dashboard can show session summaries and cost estimates for all agent types, not just Codex and Claude Code.
- **Suggested Approach**:
  - OpenCode: parse `opencode session list --format json` output (already done in `getActivityState`)
  - Aider: parse `.aider.chat.history.md` for the first user message as fallback summary

### Enhancement: Improve `detectActivity` for opencode and aider
- **Location**: `agent-opencode/src/index.ts:239-243`, `agent-aider/src/index.ts:120-124`
- **Description**: Both return "active" for any non-empty terminal output, with no pattern matching. This means the agent will always appear "active" even when showing its idle prompt.
- **Benefit**: Accurate activity indicators in the dashboard.
- **Suggested Approach**: Add prompt detection patterns similar to those in `agent-claude-code` and `agent-codex`. For aider, the prompt typically ends with `> `. For opencode, check for its specific prompt characters.

### Enhancement: Add timeout to workspace `git()` helpers
- **Location**: `workspace-worktree/src/index.ts:27-30`, `workspace-clone/src/index.ts:24-27`
- **Description**: The `git()` helper does not pass a timeout to `execFileAsync`. A hung git operation (e.g., waiting for SSH key passphrase, network issues during fetch) will block indefinitely.
- **Benefit**: Prevents hung workspace creation/destruction operations.
- **Suggested Approach**: Add `{ timeout: GIT_TIMEOUT }` to the `execFileAsync` call in the shared `git()` helper. The constant already exists in workspace-worktree but isn't used there.

### Enhancement: Parallelize codex session file scanning
- **Location**: `agent-codex/src/index.ts:363-393` (`collectJsonlFiles`), `agent-codex/src/index.ts:446-467` (`findCodexSessionFile`)
- **Description**: `collectJsonlFiles` recursively reads directories sequentially. `findCodexSessionFile` then reads the first 4 KB of each file sequentially to match `session_meta`. With hundreds of session files across date-sharded directories, this creates compounding I/O latency.
- **Benefit**: Faster session file discovery, especially on cold starts.
- **Suggested Approach**:
  1. Sort date directories newest-first and stop early when a match is found
  2. Use `Promise.all` for parallel `lstat` calls within each directory level
  3. Use `Promise.all` with a concurrency limit for the `sessionFileMatchesCwd` checks
