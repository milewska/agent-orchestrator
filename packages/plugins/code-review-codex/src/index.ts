/**
 * CodeReview plugin — OpenAI Codex.
 *
 * Wraps `codex exec review --base <base>` to produce structured findings.
 * The plugin runs directly in a reviewer workspace — no runtime, no tmux,
 * no separate agent. The Codex CLI does the actual review; this plugin is
 * thin plumbing that maps its JSON output into AO's domain model.
 *
 * The Codex session intentionally persists inside the reviewer workspace so
 * conversational follow-up via sendFollowUp can reattach to the same review
 * context. `--ephemeral` is NOT used.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type {
  CodeReview,
  CodeReviewFindingInput,
  CodeReviewFindingSeverity,
  CodeReviewFollowUpConfig,
  CodeReviewFollowUpResult,
  CodeReviewResult,
  CodeReviewRunConfig,
  PluginModule,
} from "@aoagents/ao-core";

export const manifest = {
  name: "codex",
  slot: "code-review" as const,
  description: "CodeReview plugin: OpenAI Codex (native review command)",
  version: "0.2.5",
  displayName: "Codex Reviewer",
};

interface CodexPluginConfig {
  /** Path to codex binary. Defaults to `codex` (resolved via PATH). */
  binary?: string;
  /** Extra CLI args appended after the review subcommand. */
  extraArgs?: string[];
  /** Working timeout in milliseconds. Default 10 minutes. */
  timeoutMs?: number;
}

interface CodexReviewFindingRaw {
  filePath?: string;
  file?: string;
  path?: string;
  startLine?: number;
  start_line?: number;
  endLine?: number;
  end_line?: number;
  line?: number;
  title?: string;
  summary?: string;
  description?: string;
  body?: string;
  message?: string;
  category?: string;
  severity?: string;
  priority?: string;
  confidence?: number;
  anchorSignature?: string;
  anchor?: string;
}

interface CodexReviewPayload {
  findings?: CodexReviewFindingRaw[];
  issues?: CodexReviewFindingRaw[];
  overallSummary?: string;
  summary?: string;
  overallConfidence?: number;
  confidence?: number;
  cost?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    amountUsd?: number;
  };
  errorMessage?: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export function create(rawConfig?: Record<string, unknown>): CodeReview {
  const config = normalizeConfig(rawConfig);

  return {
    name: manifest.name,

    async runReview(runConfig: CodeReviewRunConfig): Promise<CodeReviewResult> {
      if (!existsSync(runConfig.reviewerWorkspacePath)) {
        throw new Error(
          `Reviewer workspace does not exist: ${runConfig.reviewerWorkspacePath}`,
        );
      }

      const args = buildReviewArgs(runConfig, config);
      const { stdout, stderr, exitCode } = await runCodex({
        binary: config.binary,
        args,
        cwd: runConfig.reviewerWorkspacePath,
        timeoutMs: config.timeoutMs,
      });

      if (exitCode !== 0) {
        return {
          outcome: "failed",
          findings: [],
          overallSummary: "",
          errorMessage: stderr.trim() || `codex exited with code ${exitCode}`,
        };
      }

      const payload = extractJsonPayload(stdout);
      if (!payload) {
        return {
          outcome: "failed",
          findings: [],
          overallSummary: "",
          errorMessage: "Could not parse codex review output as JSON",
        };
      }

      const findings = (payload.findings ?? payload.issues ?? [])
        .map((raw) => normalizeFinding(raw))
        .filter((f): f is CodeReviewFindingInput => f !== null);

      const estimatedCostUsd = payload.cost?.estimatedCostUsd ?? payload.cost?.amountUsd;
      return {
        outcome: "completed",
        findings,
        overallSummary: payload.overallSummary ?? payload.summary ?? "",
        overallConfidence: payload.overallConfidence ?? payload.confidence,
        errorMessage: payload.errorMessage ?? payload.error,
        cost:
          typeof estimatedCostUsd === "number"
            ? {
                inputTokens: payload.cost?.inputTokens ?? 0,
                outputTokens: payload.cost?.outputTokens ?? 0,
                estimatedCostUsd,
              }
            : undefined,
      };
    },

    async sendFollowUp(
      followUp: CodeReviewFollowUpConfig,
    ): Promise<CodeReviewFollowUpResult> {
      if (!existsSync(followUp.reviewerWorkspacePath)) {
        throw new Error(
          `Reviewer workspace does not exist: ${followUp.reviewerWorkspacePath}`,
        );
      }

      const args = ["exec", "--json", followUp.message];
      const { stdout, stderr, exitCode } = await runCodex({
        binary: config.binary,
        args,
        cwd: followUp.reviewerWorkspacePath,
        timeoutMs: config.timeoutMs,
      });

      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `codex follow-up exited with code ${exitCode}`);
      }

      return {
        response: stdout.trim(),
        statusChange: "unchanged",
      };
    },

    async destroy(): Promise<void> {
      // No persistent plugin state — reviewer workspaces are managed by the lifecycle layer.
    },
  };
}

function normalizeConfig(raw?: Record<string, unknown>): Required<CodexPluginConfig> {
  const binary = typeof raw?.["binary"] === "string" ? (raw["binary"] as string) : "codex";
  const extraArgs = Array.isArray(raw?.["extraArgs"])
    ? (raw["extraArgs"] as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  const timeoutMs =
    typeof raw?.["timeoutMs"] === "number" && raw["timeoutMs"] > 0
      ? (raw["timeoutMs"] as number)
      : DEFAULT_TIMEOUT_MS;
  return { binary, extraArgs, timeoutMs };
}

function buildReviewArgs(
  runConfig: CodeReviewRunConfig,
  config: Required<CodexPluginConfig>,
): string[] {
  const args = ["exec", "review", "--base", runConfig.baseBranch, "--json"];

  if (runConfig.prompt) {
    args.push("--prompt", runConfig.prompt);
  }
  if (typeof runConfig.maxBudgetUsd === "number") {
    args.push("--max-budget-usd", String(runConfig.maxBudgetUsd));
  }
  if (typeof runConfig.confidenceThreshold === "number") {
    args.push("--confidence-threshold", String(runConfig.confidenceThreshold));
  }
  if (runConfig.severityThreshold) {
    args.push("--severity-threshold", runConfig.severityThreshold);
  }

  args.push(...config.extraArgs);
  return args;
}

interface RunOptions {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runCodex(options: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(options.binary, options.args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr: stderr || err.message,
        exitCode: 1,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolvePromise({
          stdout,
          stderr: stderr + `\ncodex review timed out after ${options.timeoutMs}ms`,
          exitCode: 124,
        });
        return;
      }
      resolvePromise({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Extract a JSON payload from codex stdout. Codex may emit log lines
 * before a final JSON block — we take the last top-level JSON object.
 */
export function extractJsonPayload(stdout: string): CodexReviewPayload | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const whole = tryParseJson(trimmed);
  if (whole) return whole;

  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (line.startsWith("{") && line.endsWith("}")) {
      const parsed = tryParseJson(line);
      if (parsed) return parsed;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParseJson(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return null;
}

function tryParseJson(raw: string): CodexReviewPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CodexReviewPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeFinding(raw: CodexReviewFindingRaw): CodeReviewFindingInput | null {
  const filePath = raw.filePath ?? raw.file ?? raw.path;
  if (!filePath) return null;

  const startLine = raw.startLine ?? raw.start_line ?? raw.line ?? 1;
  const endLine = raw.endLine ?? raw.end_line ?? startLine;

  const title = raw.title ?? raw.summary ?? raw.message ?? "Untitled finding";
  const description = raw.description ?? raw.body ?? raw.message ?? raw.summary ?? "";
  const category = raw.category ?? "general";
  const severity = normalizeSeverity(raw.severity ?? raw.priority);
  const confidence = clampConfidence(raw.confidence);
  const anchorSignature = raw.anchorSignature ?? raw.anchor;

  return {
    filePath,
    startLine,
    endLine,
    title,
    description,
    category,
    severity,
    confidence,
    anchorSignature,
  };
}

function normalizeSeverity(value: string | undefined): CodeReviewFindingSeverity {
  if (!value) return "info";
  const lower = value.toLowerCase();
  if (lower === "error" || lower === "critical" || lower === "high" || lower === "blocker") {
    return "error";
  }
  if (lower === "warning" || lower === "medium" || lower === "warn") {
    return "warning";
  }
  return "info";
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value <= 1) return value;
  // Accept 0-100 scores and scale them down
  if (value <= 100) return value / 100;
  return 1;
}

export function detect(): boolean {
  // Lightweight detection: presence of codex binary hint in PATH
  const path = process.env["PATH"] ?? "";
  return path.length > 0;
}

const pluginModule: PluginModule<CodeReview> = { manifest, create, detect };
export default pluginModule;
