import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function isWithinDirectory(parentPath: string, childPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function getHomePath(): Promise<string> {
  return realpath(homedir()).catch(() => resolve(homedir()));
}

/**
 * Resolve a path through any existing parent symlinks. If the path itself
 * doesn't exist, resolve the nearest existing ancestor and rejoin the
 * missing tail. Without this, a non-existent path with a symlinked parent
 * bypasses containment checks.
 */
async function realpathOrWalkUp(requestedPath: string): Promise<string> {
  const absolute = resolve(requestedPath);
  const real = await realpath(absolute).catch(() => null);
  if (real !== null) return real;

  const tail: string[] = [];
  let current = absolute;
  while (true) {
    const parent = dirname(current);
    if (parent === current) return absolute;
    tail.unshift(basename(current));
    const realParent = await realpath(parent).catch(() => null);
    if (realParent !== null) return join(realParent, ...tail);
    current = parent;
  }
}

export async function resolveHomeScopedPath(rawPath?: string | null): Promise<{
  homePath: string;
  resolvedPath: string;
}> {
  const homePath = await getHomePath();
  const requestedPath = rawPath
    ? isAbsolute(rawPath)
      ? rawPath
      : join(homePath, rawPath)
    : homePath;

  const resolvedPath = await realpathOrWalkUp(requestedPath);
  return { homePath, resolvedPath };
}

export async function assertPathWithinHome(rawPath?: string | null): Promise<string> {
  const { homePath, resolvedPath } = await resolveHomeScopedPath(rawPath);
  if (!isWithinDirectory(homePath, resolvedPath)) {
    throw new Error(`Path is outside the allowed directory: ${homePath}`);
  }
  return resolvedPath;
}
