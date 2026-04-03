import { describe, it, expect } from "vitest";
import {
  RegisterProjectSchema,
  CloneProjectSchema,
  UpdateProjectPrefsSchema,
  UpdatePreferencesSchema,
} from "../api-schemas";

describe("RegisterProjectSchema", () => {
  it("accepts a valid path", () => {
    const result = RegisterProjectSchema.safeParse({ path: "/home/user/project" });
    expect(result.success).toBe(true);
  });

  it("accepts path with optional name and configProjectKey", () => {
    const result = RegisterProjectSchema.safeParse({
      path: "/home/user/project",
      name: "My Project",
      configProjectKey: "my-project",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty path", () => {
    const result = RegisterProjectSchema.safeParse({ path: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing path", () => {
    const result = RegisterProjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("CloneProjectSchema", () => {
  it("accepts valid url and location", () => {
    const result = CloneProjectSchema.safeParse({
      url: "https://github.com/org/repo.git",
      location: "/home/user/repos",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid url", () => {
    const result = CloneProjectSchema.safeParse({
      url: "not-a-url",
      location: "/home/user/repos",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty location", () => {
    const result = CloneProjectSchema.safeParse({
      url: "https://github.com/org/repo.git",
      location: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateProjectPrefsSchema", () => {
  it("accepts all optional fields", () => {
    const result = UpdateProjectPrefsSchema.safeParse({
      pinned: true,
      enabled: false,
      displayName: "Custom Name",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = UpdateProjectPrefsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("UpdatePreferencesSchema", () => {
  it("accepts projectOrder and defaultProject", () => {
    const result = UpdatePreferencesSchema.safeParse({
      projectOrder: ["a", "b", "c"],
      defaultProject: "a",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = UpdatePreferencesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects non-string array for projectOrder", () => {
    const result = UpdatePreferencesSchema.safeParse({
      projectOrder: [1, 2, 3],
    });
    expect(result.success).toBe(false);
  });
});
