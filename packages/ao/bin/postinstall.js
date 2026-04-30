#!/usr/bin/env node
/**
 * Postinstall script for @aoagents/ao (npm/yarn global installs).
 *
 * 1. Fixes node-pty's spawn-helper binary missing the execute bit.
 *    node-pty@1.1.0 ships spawn-helper without +x; the monorepo works around
 *    this via scripts/rebuild-node-pty.js, but that never runs for global installs.
 *    Upstream fix: microsoft/node-pty#866 (only in 1.2.0-beta, not stable yet).
 *
 * 2. Verifies the prebuilt binary is compatible with the current Node.js version.
 *    If not (common with nvm/fnm/volta), rebuilds from source via npx node-gyp.
 *    See: https://github.com/ComposioHQ/agent-orchestrator/issues/987
 *
 * 3. Clears dashboard install cache and records the installed AO version so
 *    stale Next.js artifacts do not survive global package updates.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findPackageUp(startDir, ...segments) {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, "node_modules", ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveNodeModulesPackage(fromDir, ...segments) {
  const packageDir = resolve(fromDir, "node_modules", ...segments);
  return existsSync(resolve(packageDir, "package.json")) ? packageDir : null;
}

function findWebDir() {
  const directWebDir = findPackageUp(__dirname, "@aoagents", "ao-web");
  if (directWebDir) return directWebDir;

  const cliDir = findPackageUp(__dirname, "@aoagents", "ao-cli");
  if (!cliDir) return null;

  return resolveNodeModulesPackage(cliDir, "@aoagents", "ao-web");
}

function getInstalledAoVersion() {
  try {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, "..", "package.json"), "utf8"),
    );
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

function cleanDashboardInstallCache() {
  const webDir = findWebDir();
  if (!webDir) return;

  const nextDir = resolve(webDir, ".next");
  const cacheDir = resolve(nextDir, "cache");

  try {
    rmSync(cacheDir, { recursive: true, force: true });

    const version = getInstalledAoVersion();
    if (version) {
      mkdirSync(nextDir, { recursive: true });
      writeFileSync(resolve(nextDir, "AO_VERSION"), `${version}\n`);
    }

    console.log("\u2713 dashboard install cache refreshed");
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    console.warn(
      `\u26a0\ufe0f  Could not refresh dashboard install cache (non-critical)${detail}`,
    );
  }
}

cleanDashboardInstallCache();

// No-op on Windows for node-pty — different PTY mechanism.
if (process.platform === "win32") process.exit(0);

const nodePtyDir = findPackageUp(__dirname, "node-pty");
if (!nodePtyDir) process.exit(0);

// Step 1: Fix spawn-helper permissions
const spawnHelper = resolve(
  nodePtyDir,
  "prebuilds",
  `${process.platform}-${process.arch}`,
  "spawn-helper",
);

if (existsSync(spawnHelper)) {
  try {
    chmodSync(spawnHelper, 0o755);
    console.log("\u2713 node-pty spawn-helper permissions set");
  } catch {
    console.warn("\u26a0\ufe0f  Could not set spawn-helper permissions (non-critical)");
  }
}

// Step 2: Verify the prebuilt binary actually works with this Node.js version.
// If it doesn't (ABI mismatch from nvm/fnm/volta version switching), rebuild.
// We exercise pty.spawn() — not just require() — because the posix_spawnp
// failure only surfaces when the helper binary is actually executed.
try {
  execSync(
    "node -e \"var p=require('node-pty');var t=p.spawn('/bin/sh',['-c','exit 0'],{});t.kill();process.exit(0);\"",
    {
      cwd: resolve(nodePtyDir, ".."),
      stdio: "ignore",
      timeout: 10000,
    },
  );
} catch {
  console.log("\u26a0\ufe0f  node-pty prebuilt binary incompatible with Node.js " + process.version + ", rebuilding...");
  try {
    execSync("npx --yes node-gyp rebuild", {
      cwd: nodePtyDir,
      stdio: "inherit",
      timeout: 120000,
    });
    console.log("\u2713 node-pty rebuilt successfully");
  } catch {
    console.warn("\u26a0\ufe0f  node-pty rebuild failed — web terminal may not work");
    console.warn("  Manual fix: cd " + nodePtyDir + " && npx node-gyp rebuild");
  }
}
