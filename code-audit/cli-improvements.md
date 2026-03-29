# Refactoring Improvements Roadmap — `packages/cli/`

## Critical Refactors

### Refactor: Decompose `start.ts` into Focused Modules
- **Location**: `src/commands/start.ts` (1,296 lines)
- **Problem**: This single file handles config creation, URL-based cloning, path-based project addition, interactive project selection, dependency installation (git/tmux/gh/agent runtimes), dashboard spawning, lifecycle worker management, orchestrator session creation, running state registration, and stop functionality. The `registerStart.action()` handler (lines 1014-1193) is 180 lines of nested branching. This makes the file extremely difficult to modify, test, or review.
- **Impact**: Any change to start-up flow risks regressions across unrelated features. New contributors cannot understand the startup sequence without reading the entire file. The function is too large to hold in working memory.
- **Suggested Approach**: Split into 4 modules:
  - `start-config.ts` — `autoCreateConfig()`, `addProjectToConfig()`, `resolveProject()`, `resolveProjectByRepo()`, `handleUrlStart()`
  - `start-install.ts` — `ensureGit()`, `ensureTmux()`, `promptInstallAgentRuntime()`, `tryInstallWithAttempts()`, `askYesNo()`, install attempt generators
  - `start-runtime.ts` — `runStartup()`, `startDashboard()`, `stopDashboard()`, `createConfigOnly()`
  - `start.ts` — thin command registration that composes the above modules

  Each module becomes independently testable. The main `start.ts` action handler shrinks to ~50 lines of flow control.

### Refactor: Extract Generic Installation Helper
- **Location**: `src/commands/start.ts` lines 260-299 (`tryInstallWithAttempts`, `ensureGit`), 758-807 (`ensureTmux`), 336-376 (`promptInstallAgentRuntime`)
- **Problem**: The "check → prompt → install → verify → hint" pattern is copy-pasted 4 times with different binaries. Adding a new dependency (e.g., Docker) would require duplicating the pattern again.
- **Impact**: Bug fixes to the installation flow must be applied in 4 places. Inconsistencies already exist — `ensureGit` and `ensureTmux` call `process.exit(1)` on failure while `promptInstallAgentRuntime` returns silently.
- **Suggested Approach**: Extract a generic helper:
  ```typescript
  interface DependencySpec {
    name: string;
    checkCmd: [string, string[]];
    installAttempts: InstallAttempt[];
    installHints: string[];
    required: boolean; // true = exit on failure, false = warn and continue
  }

  async function ensureDependency(spec: DependencySpec): Promise<boolean> {
    // Unified check → prompt → install → verify → hint flow
  }
  ```
  Each dependency becomes a declarative spec instead of procedural code.

### Refactor: Add Structured Logging to Silent Catch Blocks
- **Location**: `src/commands/status.ts` (5 instances), `src/commands/send.ts` (2 instances), `src/commands/spawn.ts` (2 instances), `src/commands/session.ts` (1 instance), and ~5 more across lib files
- **Problem**: At least 12 catch blocks silently discard errors with `// Not critical` comments. When sessions show stale data or commands silently fail, operators have no way to diagnose the root cause without adding ad-hoc debug logging.
- **Impact**: Production debugging requires code changes to add logging, which means redeploying. Issues that appear intermittently (e.g., GitHub API rate limits, network timeouts) are invisible until they cascade.
- **Suggested Approach**: Introduce a lightweight debug logger (using `DEBUG` env var or `--verbose` flag):
  ```typescript
  // src/lib/debug.ts
  const DEBUG = process.env.AO_DEBUG === "1" || process.argv.includes("--verbose");
  export function debugLog(context: string, msg: string, err?: unknown): void {
    if (!DEBUG) return;
    const errMsg = err instanceof Error ? err.message : err ? String(err) : "";
    console.error(`[debug:${context}] ${msg}${errMsg ? `: ${errMsg}` : ""}`);
  }
  ```
  Replace `catch { /* not critical */ }` with `catch (err) { debugLog("status", "SCM lookup failed", err); }`. Zero overhead when not enabled.

## Medium Priority Improvements

### Refactor: Consolidate Session Entry Parsing in `session.ts`
- **Location**: `src/commands/session.ts` lines 149-163
- **Problem**: `filterCleanupIds()` and `filterCleanupErrors()` both parse colon-separated `projectId:sessionId` strings with identical logic:
  ```typescript
  const separator = entry.indexOf(":");
  const entryProjectId = separator === -1 ? opts.project : entry.slice(0, separator);
  const sessionId = separator === -1 ? entry : entry.slice(separator + 1);
  ```
  This parsing is duplicated verbatim.
- **Impact**: Any change to the entry format must be updated in two places. The filter logic is hard to follow because the parsing obscures the intent.
- **Suggested Approach**: Extract a helper:
  ```typescript
  function parseCleanupEntry(entry: string, defaultProject?: string) {
    const sep = entry.indexOf(":");
    return {
      projectId: sep === -1 ? defaultProject : entry.slice(0, sep),
      sessionId: sep === -1 ? entry : entry.slice(sep + 1),
    };
  }
  ```
  Then both filters call `parseCleanupEntry()` and test `isOrchestratorSessionName()` on the result. Could also be a single generic filter function parameterized by accessor.

### Refactor: Standardize Error Exit Strategy
- **Location**: Multiple command files — `spawn.ts`, `session.ts`, `verify.ts`, `send.ts`
- **Problem**: Some commands throw errors that bubble up to a top-level catch (e.g., `start.ts`), while others call `process.exit(1)` mid-function. `spawn.ts` has 4 `process.exit(1)` calls (lines 193, 207, 214, 221), `session.ts` has 5 (lines 23, 92, 128, 243, 305). This inconsistency makes control flow unpredictable and prevents cleanup code from running.
- **Impact**: Testing commands that call `process.exit()` requires mocking the process object. Cleanup handlers (e.g., releasing locks, closing connections) are bypassed. Error messages are formatted inconsistently.
- **Suggested Approach**: Adopt a single pattern: all command actions throw errors; the top-level registration wraps each action in a standard error handler:
  ```typescript
  function withErrorHandler(fn: (...args: unknown[]) => Promise<void>) {
    return async (...args: unknown[]) => {
      try {
        await fn(...args);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    };
  }
  ```
  Replace `process.exit(1)` in command bodies with `throw new Error(...)`.

### Refactor: Extract Magic Numbers into Named Constants
- **Location**: Scattered across `send.ts`, `web-dir.ts`, `running-state.ts`, `lifecycle-service.ts`, `dashboard.ts`, `spawn.ts`, `start.ts`
- **Problem**: At least 12 hardcoded numeric values control timing, limits, and ports without named constants. Examples: `5000` (poll interval), `300` (socket timeout), `500` (inter-spawn delay), `100` (max stderr chunks), `14800` (terminal port).
- **Impact**: Understanding "what does `300` mean here?" requires reading surrounding context. Changing a timeout requires finding every occurrence of the same number. Two different `5000` values (send poll interval vs. lock timeout) are unrelated but visually identical.
- **Suggested Approach**: Create `src/lib/constants.ts`:
  ```typescript
  // Timing
  export const SEND_POLL_INTERVAL_MS = 5_000;
  export const SEND_RETRY_DELAY_MS = 2_000;
  export const SOCKET_TIMEOUT_MS = 300;
  export const INTER_SPAWN_DELAY_MS = 500;

  // Limits
  export const MAX_STDERR_CHUNKS = 100;
  export const MAX_PORT_SCAN = 100;
  export const MAX_PORT_PAIR_ATTEMPTS = 50;

  // Ports
  export const DEFAULT_DASHBOARD_PORT = 3_000;
  export const DEFAULT_TERMINAL_PORT = 14_800;
  ```

### Refactor: Reduce Repetition in `project-detection.ts`
- **Location**: `src/lib/project-detection.ts` lines 47-58
- **Problem**: Six framework/dependency checks repeat the same pattern:
  ```typescript
  if (pkg?.dependencies?.react || pkg?.devDependencies?.react) {
    type.frameworks.push("react");
  }
  if (pkg?.dependencies?.next || pkg?.devDependencies?.next) {
    type.frameworks.push("nextjs");
  }
  // ... 4 more identical patterns
  ```
- **Impact**: Adding a new framework detection requires copying the pattern. Easy to introduce typos.
- **Suggested Approach**:
  ```typescript
  const frameworkDeps: Array<[string, string]> = [
    ["react", "react"], ["next", "nextjs"], ["vue", "vue"], ["express", "express"],
  ];
  for (const [dep, name] of frameworkDeps) {
    if (pkg?.dependencies?.[dep] || pkg?.devDependencies?.[dep]) {
      type.frameworks.push(name);
    }
  }
  ```

### Refactor: Make `padCol` Preserve ANSI When Truncating
- **Location**: `src/lib/format.ts` lines 111-122
- **Problem**: When truncating, `padCol` strips all ANSI codes and returns a plain-text truncated string (line 117). This means truncated cells lose their color styling, creating visual inconsistency — short values have color, long values don't.
- **Impact**: Status table rows with long branch names or session names appear unstyled compared to shorter ones.
- **Suggested Approach**: Use a library like `slice-ansi` (already in the ecosystem for CLI tools) to truncate while preserving ANSI escape sequences, or implement character-by-character truncation that tracks open/close ANSI sequences.

## Nice-to-Have Enhancements

### Enhancement: Add Unit Tests for Untested Library Files
- **Location**: `src/lib/lifecycle-service.ts`, `src/lib/running-state.ts`, `src/lib/web-dir.ts`, `src/lib/project-detection.ts`, `src/lib/detect-agent.ts`, `src/lib/dashboard-rebuild.ts`, `src/lib/create-session-manager.ts`, `src/lib/detect-env.ts`, `src/lib/git-utils.ts`, `src/lib/script-runner.ts`, `src/lib/caller-context.ts`
- **Description**: 11 of 19 library files (58%) have no dedicated unit tests. Some of these (lifecycle-service, running-state) manage critical process state.
- **Benefit**: Catch regressions in process management, port detection, and project type detection. Enable confident refactoring of the start.ts decomposition.
- **Suggested Approach**: Prioritize by risk:
  1. `lifecycle-service.ts` — mock `spawn`, test PID file lifecycle and SIGTERM→SIGKILL escalation
  2. `running-state.ts` — test lock acquisition, stale entry pruning, concurrent access
  3. `project-detection.ts` — test detection for each language/framework with fixture directories
  4. `web-dir.ts` — mock `Socket` to test port scanning logic
  5. Remaining files — lower risk, test as time allows

### Enhancement: Consolidate Interactive Prompting
- **Location**: `src/commands/start.ts` (3 uses of `readline/promises`), `src/lib/detect-agent.ts` (1 use), `src/commands/setup.ts` (uses `@clack/prompts`)
- **Description**: The CLI uses two different prompting mechanisms: raw `readline/promises` (in start.ts and detect-agent.ts) and `@clack/prompts` (in setup.ts). The readline usage follows the same pattern each time: import, create interface, ask question, parse int, close. This could be unified.
- **Benefit**: Consistent UX across all interactive flows. Reduced boilerplate. Easier to add a `--non-interactive` mode to commands that don't have it.
- **Suggested Approach**: Either standardize on `@clack/prompts` for all interactive flows, or create a thin `src/lib/prompt.ts` wrapper around readline that handles the common patterns (yes/no, numbered list selection, text input).

### Enhancement: Graceful Windows/Non-tmux Support
- **Location**: `src/lib/dashboard-rebuild.ts` (uses `lsof`), `src/commands/start.ts` (uses `lsof` in `stopDashboard`), `src/commands/send.ts` (tmux-only delivery)
- **Description**: The CLI has hard dependencies on Unix tools (`lsof`, `tmux`) with no Windows fallback. `stopDashboard()` (start.ts:980-998) uses `lsof -ti :port` which doesn't exist on Windows.
- **Benefit**: Broader platform support without breaking existing Unix functionality.
- **Suggested Approach**: Abstract process-finding behind a platform-aware utility:
  ```typescript
  async function findProcessOnPort(port: number): Promise<number[]> {
    if (process.platform === "win32") {
      // Use netstat -ano | findstr :port
    } else {
      // Use lsof -ti :port
    }
  }
  ```
  For tmux dependency, document it as a requirement and fail early with a clear error on unsupported platforms.

### Enhancement: Rate-Limit SCM Queries in `status.ts`
- **Location**: `src/commands/status.ts` lines 278-279
- **Problem**: `gatherSessionInfo()` is called via `Promise.all` for all sessions, each making up to 4 SCM API calls (detectPR, getCISummary, getReviewDecision, getPendingComments). With 20 sessions, this fires 80 concurrent GitHub API requests.
- **Benefit**: Avoid hitting GitHub's secondary rate limits (which throttle concurrent requests from the same IP/token).
- **Suggested Approach**: Use a simple concurrency limiter (e.g., `p-limit` or a manual semaphore) to cap concurrent SCM calls at 5-10. The status output appears incrementally anyway, so the user wouldn't notice the serialization.
