import type { Preset } from "./types.js";
import { backlogPreset } from "./backlog.js";
import { triagePreset } from "./triage.js";

const PRESETS: ReadonlyMap<string, Preset> = new Map([
  [backlogPreset.name, backlogPreset],
  [triagePreset.name, triagePreset],
]);

/**
 * Look up a preset by name. Throws with a helpful message if not found.
 */
export function resolvePreset(name: string): Preset {
  const preset = PRESETS.get(name);
  if (!preset) {
    const available = [...PRESETS.keys()].join(", ");
    throw new Error(
      `Unknown preset "${name}". Available presets: ${available}`,
    );
  }
  return preset;
}
