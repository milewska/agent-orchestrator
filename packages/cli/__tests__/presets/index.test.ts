import { describe, it, expect } from "vitest";
import { resolvePreset } from "../../src/presets/index.js";
import { backlogPreset } from "../../src/presets/backlog.js";
import { triagePreset } from "../../src/presets/triage.js";

describe("resolvePreset", () => {
  it("returns the backlog preset by name", () => {
    const preset = resolvePreset("backlog");
    expect(preset).toBe(backlogPreset);
    expect(preset.name).toBe("backlog");
  });

  it("returns the triage preset by name", () => {
    const preset = resolvePreset("triage");
    expect(preset).toBe(triagePreset);
    expect(preset.name).toBe("triage");
  });

  it("throws for unknown preset names", () => {
    expect(() => resolvePreset("nonexistent")).toThrow("Unknown preset");
  });

  it("includes available presets in the error message", () => {
    expect(() => resolvePreset("nope")).toThrow(/backlog.*triage|triage.*backlog/);
  });
});

describe("backlog preset", () => {
  it("has required fields", () => {
    expect(backlogPreset.name).toBe("backlog");
    expect(backlogPreset.description).toBeTruthy();
    expect(backlogPreset.prompt).toBeTruthy();
  });

  it("prompt contains key instructions", () => {
    const { prompt } = backlogPreset;
    expect(prompt).toContain("ao status --reports full --json --include-terminated");
    expect(prompt).toContain("gh issue list");
    expect(prompt).toContain("gh pr list");
    expect(prompt).toContain("backlog/report_");
    expect(prompt).toContain("ao send");
    expect(prompt).toContain("dashboard_");
    expect(prompt).toContain("ao report completed");
  });

  it("prompt is multi-line markdown with preserved newlines", () => {
    expect(backlogPreset.prompt).toContain("\n");
    expect(backlogPreset.prompt.split("\n").length).toBeGreaterThan(10);
  });

  it("forbids issue arg (default, no specific value set)", () => {
    // Backlog analyzes the whole project, not a specific issue
    const policy = backlogPreset.issueArg ?? "forbidden";
    expect(policy).toBe("forbidden");
  });
});

describe("triage preset", () => {
  it("has required fields", () => {
    expect(triagePreset.name).toBe("triage");
    expect(triagePreset.description).toBeTruthy();
    expect(triagePreset.prompt).toBeTruthy();
  });

  it("requires an issue argument", () => {
    expect(triagePreset.issueArg).toBe("required");
  });

  it("prompt contains key instructions", () => {
    const { prompt } = triagePreset;
    expect(prompt).toContain("Triage Analyst");
    expect(prompt).toContain("AO_ISSUE_ID");
    expect(prompt).toContain("gh issue view");
    expect(prompt).toContain("gh issue comment");
    expect(prompt).toContain("triage/issue_");
    expect(prompt).toContain("ao report completed");
  });

  it("explicitly forbids committing changes", () => {
    expect(triagePreset.prompt).toContain("Do NOT commit");
    expect(triagePreset.prompt).toContain("Do NOT open a PR");
  });
});
