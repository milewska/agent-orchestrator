/**
 * Multi-project registration and sync logic for `ao start`.
 *
 * Pure functions that handle project registration, shadow sync, and
 * config building without any CLI dependencies (no chalk, no console).
 * The CLI command wraps these with user-facing output.
 */

import { resolve, basename } from "node:path";
import type { OrchestratorConfig } from "./types.js";
import {
  type GlobalConfig,
  type GlobalProjectEntry,
  loadGlobalConfig,
  saveGlobalConfig,
  registerProject,
  detectConfigMode,
  findLocalConfigPath,
  findLocalConfigUpwards,
  loadLocalProjectConfig,
  syncShadow,
  loadShadowFile,
  saveShadowFile,
  deleteShadowFile,
  matchProjectByCwd,
  findGlobalConfigPath,
} from "./global-config.js";
import { buildEffectiveConfig } from "./migration.js";
import { generateSessionPrefix, generateProjectId, expandHome } from "./paths.js";
import { applyGlobalConfigPipeline } from "./config.js";

// ---------------------------------------------------------------------------
// Shared registration helper (used by both ao project add and resolveMultiProjectStart)
// ---------------------------------------------------------------------------

export interface RegisterNewProjectOpts {
  /** Explicit project ID requested by the user (e.g. via --id). Throws on collision. */
  explicitId?: string;
  /** Name override (e.g. via --name). Falls back to basename(projectPath). */
  name?: string;
}

export interface RegisterNewProjectResult {
  projectId: string;
  /** Updated global config with the new project registered (not yet saved). */
  updatedGlobalConfig: GlobalConfig;
  configMode: "hybrid" | "global-only";
  messages: Array<{ level: "info" | "warn" | "success"; text: string }>;
}

/**
 * Register a new project in the global config registry and write its shadow file.
 *
 * Handles: ID derivation, collision resolution, registerProject, shadow sync
 * (hybrid) or scaffold (global-only), and session prefix writeback for
 * auto-suffixed IDs.
 *
 * Does NOT validate (applyGlobalConfigPipeline) or save (saveGlobalConfig) —
 * the caller is responsible for both so it can clean up on validation failure.
 *
 * Throws if shadow sync fails on a new registration — this prevents persisting
 * a broken state where the project is registered but has an empty/missing shadow.
 */
export function registerNewProject(
  globalConfig: GlobalConfig,
  projectPath: string,
  opts?: RegisterNewProjectOpts,
): RegisterNewProjectResult {
  const messages: RegisterNewProjectResult["messages"] = [];

  // Derive project ID
  let projectId = opts?.explicitId ?? generateSessionPrefix(generateProjectId(projectPath));
  const originalProjectId = projectId;

  // Collision resolution
  if (globalConfig.projects[projectId]) {
    const conflicting = globalConfig.projects[projectId];
    if (resolve(expandHome(conflicting.path)) !== projectPath) {
      if (opts?.explicitId) {
        throw new Error(
          `Project ID "${projectId}" is already in use by ${conflicting.path}.`,
        );
      }
      let suffix = 2;
      let altId = `${projectId}${suffix}`;
      while (globalConfig.projects[altId]) {
        suffix++;
        altId = `${projectId}${suffix}`;
      }
      messages.push({ level: "warn", text: `ID "${projectId}" taken, using "${altId}"` });
      projectId = altId;
    }
  }

  const entry: GlobalProjectEntry = {
    name: opts?.name ?? basename(projectPath),
    path: projectPath,
  };
  let updatedGlobalConfig = registerProject(globalConfig, projectId, entry);

  // Shadow sync (hybrid) or scaffold (global-only)
  const configMode = detectConfigMode(projectPath);
  if (configMode === "hybrid") {
    const localPath = findLocalConfigPath(projectPath);
    if (localPath) {
      // Propagate sync errors — a failed sync leaves the shadow absent/empty,
      // which produces a project with no repo/agent/tracker (broken state).
      const localConfig = loadLocalProjectConfig(localPath);
      const { config: synced, excludedSecrets } = syncShadow(updatedGlobalConfig, projectId, localConfig);
      updatedGlobalConfig = synced;
      if (excludedSecrets.length > 0) {
        messages.push({ level: "warn", text: `Excluded secret-like fields: ${excludedSecrets.join(", ")}` });
      }
      messages.push({ level: "success", text: "Shadow synced" });
    }
  } else {
    // Global-only: scaffold a minimal shadow so buildEffectiveConfig has a file
    // to read — without it repo/defaultBranch/agent all fall back to empty defaults.
    if (!loadShadowFile(projectId)) {
      saveShadowFile(projectId, { repo: "", defaultBranch: "main" });
    }
  }

  // If the ID was auto-suffixed to resolve a collision (e.g. "ao" → "ao2"),
  // applyProjectDefaults would re-derive the prefix from basename(path), producing
  // the same prefix as the original project and causing a prefix collision.
  // Write the suffixed prefix explicitly to the shadow so applyProjectDefaults
  // uses it instead of re-deriving from the path.
  if (projectId !== originalProjectId) {
    const currentShadow = loadShadowFile(projectId) ?? {};
    saveShadowFile(projectId, { ...currentShadow, sessionPrefix: generateSessionPrefix(projectId) });
  }

  return { projectId, updatedGlobalConfig, configMode, messages };
}

// ---------------------------------------------------------------------------
// Multi-project start result
// ---------------------------------------------------------------------------

export interface MultiProjectStartResult {
  config: OrchestratorConfig;
  projectId: string;
  /** Messages for the CLI to display (type + text) */
  messages: Array<{ level: "info" | "warn" | "success"; text: string }>;
}

/**
 * Core logic for multi-project registration and shadow sync.
 *
 * Returns null if no global config exists (caller should fall back to
 * legacy single-file flow).
 */
export function resolveMultiProjectStart(
  workingDir: string,
): MultiProjectStartResult | null {
  const resolvedDir = resolve(workingDir);
  const messages: MultiProjectStartResult["messages"] = [];

  // Load global config
  let globalConfig = loadGlobalConfig();
  if (!globalConfig) {
    return null;
  }

  // 3. Match CWD to a registered project
  let projectId = matchProjectByCwd(globalConfig, resolvedDir);
  let isNewRegistration = false;

  if (!projectId) {
    const found = findLocalConfigUpwards(resolvedDir);
    const projectRoot = found?.projectRoot ?? resolvedDir;

    if (found) {
      // Auto-register via shared helper — handles ID derivation, collision,
      // shadow sync, and session prefix writeback.
      const reg = registerNewProject(globalConfig, projectRoot);
      projectId = reg.projectId;
      globalConfig = reg.updatedGlobalConfig;
      isNewRegistration = true;
      messages.push(...reg.messages);
      messages.push({ level: "success", text: `Registered project "${projectId}" (${reg.configMode} mode)` });
    } else {
      return null;
    }
  } else {
    // Already registered — sync shadow if hybrid
    const registeredPath = expandHome(globalConfig.projects[projectId].path);
    const mode = detectConfigMode(registeredPath);
    if (mode === "hybrid") {
      const localPath = findLocalConfigPath(registeredPath);
      if (localPath) {
        try {
          const localConfig = loadLocalProjectConfig(localPath);
          // syncShadow writes to the shadow file and returns globalConfig unchanged.
          // No need to saveGlobalConfig — the global registry entry is unmodified.
          const { excludedSecrets } = syncShadow(globalConfig, projectId, localConfig);
          if (excludedSecrets.length > 0) {
            messages.push({ level: "warn", text: `Excluded secret-like fields: ${excludedSecrets.join(", ")}` });
          }
        } catch (err) {
          messages.push({ level: "warn", text: `Shadow sync failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  }

  // 4. Build effective config via the shared pipeline (single source of truth in config.ts).
  // validateProjectUniqueness runs inside applyGlobalConfigPipeline — run this BEFORE
  // saveGlobalConfig so that a session prefix collision throws before the broken state
  // is persisted to disk.
  const globalPath = findGlobalConfigPath();
  const buildWarnings: string[] = [];
  const built = buildEffectiveConfig(globalConfig, globalPath, buildWarnings);
  for (const w of buildWarnings) {
    messages.push({ level: "warn", text: w });
  }
  let effectiveConfig: ReturnType<typeof applyGlobalConfigPipeline>;
  try {
    effectiveConfig = applyGlobalConfigPipeline(built);
  } catch (validationErr) {
    // Validation failed (e.g. session prefix collision) — clean up any shadow
    // file written during this registration so it doesn't remain as an orphan.
    // The global config was never saved, so the project is unregistered.
    if (isNewRegistration) {
      deleteShadowFile(projectId);
    }
    throw validationErr;
  }

  // 5. Persist only after validation passes (new registrations only — already-registered
  //    projects don't modify globalConfig so nothing to save).
  if (isNewRegistration) {
    saveGlobalConfig(globalConfig);
  }

  return { config: effectiveConfig, projectId, messages };
}
