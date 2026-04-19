import { describe, it, expect } from "vitest";
import pluginModule, { extractJsonPayload, normalizeFinding } from "../index.js";

describe("code-review-codex plugin", () => {
  it("exposes a valid manifest", () => {
    expect(pluginModule.manifest.name).toBe("codex");
    expect(pluginModule.manifest.slot).toBe("code-review");
    expect(pluginModule.manifest.version).toBeTypeOf("string");
  });

  it("creates an instance with required methods", () => {
    const instance = pluginModule.create();
    expect(instance.name).toBe("codex");
    expect(typeof instance.runReview).toBe("function");
    expect(typeof instance.sendFollowUp).toBe("function");
  });
});

describe("extractJsonPayload", () => {
  it("parses whole-stdout JSON", () => {
    const raw = JSON.stringify({ overallSummary: "ok", findings: [] });
    expect(extractJsonPayload(raw)).toEqual({ overallSummary: "ok", findings: [] });
  });

  it("returns null for non-JSON output", () => {
    expect(extractJsonPayload("hello world")).toBe(null);
  });

  it("picks up a final JSON line", () => {
    const raw = [
      "[info] running review...",
      "[info] 3 files changed",
      JSON.stringify({ findings: [{ file: "a.ts", line: 1, title: "t" }] }),
    ].join("\n");
    const payload = extractJsonPayload(raw);
    expect(payload?.findings?.[0]?.title).toBe("t");
  });
});

describe("normalizeFinding", () => {
  it("normalizes flexible codex shapes", () => {
    const f = normalizeFinding({
      file: "src/a.ts",
      line: 10,
      title: "t",
      body: "b",
      severity: "warning",
      confidence: 0.9,
    });
    expect(f).toMatchObject({
      filePath: "src/a.ts",
      startLine: 10,
      endLine: 10,
      severity: "warning",
      confidence: 0.9,
    });
  });

  it("rejects findings without a file path", () => {
    expect(normalizeFinding({ title: "x" })).toBe(null);
  });

  it("clamps 0-100 confidence into 0-1", () => {
    const f = normalizeFinding({ file: "a", line: 1, title: "t", confidence: 80 });
    expect(f?.confidence).toBeCloseTo(0.8, 2);
  });

  it("maps priority strings to severity", () => {
    expect(normalizeFinding({ file: "a", line: 1, title: "t", priority: "high" })?.severity).toBe(
      "error",
    );
    expect(
      normalizeFinding({ file: "a", line: 1, title: "t", priority: "medium" })?.severity,
    ).toBe("warning");
    expect(normalizeFinding({ file: "a", line: 1, title: "t", priority: "low" })?.severity).toBe(
      "info",
    );
  });
});
