/**
 * A preset is a predefined prompt + metadata that can be used with `ao spawn --preset <name>`.
 * Presets are trusted (no sanitization or length limits applied to their prompts).
 */
/**
 * How a preset relates to the `[issue]` positional argument on `ao spawn`.
 * - `forbidden` (default): preset rejects an issue arg (e.g. `backlog` analyzes the whole project)
 * - `required`: preset must have an issue arg (e.g. `triage` operates on a specific issue)
 * - `optional`: either is fine (preset adapts based on whether an issue was provided)
 */
export type PresetIssueArg = "required" | "optional" | "forbidden";

export interface Preset {
  /** Unique name used in `--preset <name>` */
  readonly name: string;
  /** Short description shown in help text */
  readonly description: string;
  /** The full prompt/instructions sent to the spawned agent */
  readonly prompt: string;
  /**
   * How this preset relates to the issue positional arg.
   * Omit to default to `"forbidden"` (most presets are standalone analysis tasks).
   */
  readonly issueArg?: PresetIssueArg;
}
