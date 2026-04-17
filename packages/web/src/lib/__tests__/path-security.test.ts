import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isWithinDirectory, getHomePath, resolveHomeScopedPath, assertPathWithinHome } from "../path-security";

let tmpHome: string;
let realTmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "ao-path-sec-"));
  realTmpHome = realpathSync(tmpHome);
  prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("isWithinDirectory", () => {
  it("returns true when child is same as parent", () => {
    expect(isWithinDirectory("/home/user", "/home/user")).toBe(true);
  });
  it("returns true when child is inside parent", () => {
    expect(isWithinDirectory("/home/user", "/home/user/projects/app")).toBe(true);
  });
  it("returns false when child is outside parent", () => {
    expect(isWithinDirectory("/home/user", "/etc/passwd")).toBe(false);
  });
  it("returns false for path traversal", () => {
    expect(isWithinDirectory("/home/user", "/home/user/../other")).toBe(false);
  });
});

describe("getHomePath", () => {
  it("returns the realpath-resolved home directory", async () => {
    expect(await getHomePath()).toBe(realTmpHome);
  });
});

describe("resolveHomeScopedPath", () => {
  it("returns home path when no rawPath is provided", async () => {
    const result = await resolveHomeScopedPath();
    expect(result.homePath).toBe(realTmpHome);
    expect(result.resolvedPath).toBe(realTmpHome);
  });

  it("joins relative path with home directory and resolves", async () => {
    const target = join(tmpHome, "relative");
    mkdirSync(target);
    const result = await resolveHomeScopedPath("relative");
    expect(result.resolvedPath).toBe(realpathSync(target));
  });

  it("resolves non-existent path through existing parent symlinks", async () => {
    // Create: tmpHome/realdir, tmpHome/linkdir -> realdir
    // Ask for tmpHome/linkdir/new → should resolve via linkdir's realpath
    const realDir = join(tmpHome, "realdir");
    mkdirSync(realDir);
    const linkDir = join(tmpHome, "linkdir");
    symlinkSync(realDir, linkDir);

    const requested = join(linkDir, "newthing");
    const result = await resolveHomeScopedPath(requested);
    expect(result.resolvedPath).toBe(join(realpathSync(realDir), "newthing"));
  });
});

describe("assertPathWithinHome", () => {
  it("returns resolved path when within home", async () => {
    const inside = join(tmpHome, "projects");
    mkdirSync(inside);
    expect(await assertPathWithinHome(inside)).toBe(realpathSync(inside));
  });

  it("throws when path is outside home", async () => {
    await expect(assertPathWithinHome("/etc/passwd")).rejects.toThrow();
  });

  it("throws when a non-existent path's parent symlink escapes home", async () => {
    // Create an escape symlink inside tmpHome that points outside
    const escape = join(tmpHome, "escape");
    symlinkSync(tmpdir(), escape);
    // A non-existent child under the symlink resolves outside home.
    await expect(assertPathWithinHome(join(escape, "nope"))).rejects.toThrow();
  });
});
