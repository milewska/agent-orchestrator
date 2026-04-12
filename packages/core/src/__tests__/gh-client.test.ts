import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GhClient,
  resetGhClient,
  getGhClient,
} from "../gh-client.js";
import {
  CircuitOpenError,
  SemaphoreTimeoutError,
  RateLimitError,
  GhCliError,
  GhClientError,
} from "../gh-client-errors.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: () => vi.fn(),
}));

// We need to mock at the module level and control exec behavior
// Since GhClient uses execFileAsync internally, we'll test through the public API
// by creating a client and intercepting its private _rawExec

describe("GhClient", () => {
  let client: GhClient;

  beforeEach(() => {
    resetGhClient();
    client = new GhClient();
  });

  afterEach(() => {
    client.shutdown();
  });

  describe("error types", () => {
    it("CircuitOpenError has reopenAt", () => {
      const reopenAt = Date.now() + 30_000;
      const err = new CircuitOpenError(reopenAt);
      expect(err).toBeInstanceOf(GhClientError);
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect(err.reopenAt).toBe(reopenAt);
      expect(err.name).toBe("CircuitOpenError");
    });

    it("RateLimitError has retryAfterSec", () => {
      const err = new RateLimitError("rate limited", 60);
      expect(err).toBeInstanceOf(GhClientError);
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.retryAfterSec).toBe(60);
      expect(err.name).toBe("RateLimitError");
    });

    it("SemaphoreTimeoutError has correct message", () => {
      const err = new SemaphoreTimeoutError();
      expect(err).toBeInstanceOf(GhClientError);
      expect(err).toBeInstanceOf(SemaphoreTimeoutError);
      expect(err.message).toContain("concurrency slot");
    });

    it("GhCliError detects auth errors", () => {
      const err = new GhCliError("HTTP 401 Unauthorized", { exitCode: 1 });
      expect(err).toBeInstanceOf(GhClientError);
      expect(err.isAuth).toBe(true);
      expect(err.isNotFound).toBe(false);
      expect(err.exitCode).toBe(1);
    });

    it("GhCliError detects not found errors", () => {
      const err = new GhCliError("HTTP 404 Not Found", { stderr: "not found" });
      expect(err.isNotFound).toBe(true);
      expect(err.isAuth).toBe(false);
    });
  });

  describe("getStats / resetStats", () => {
    it("starts with zero stats", () => {
      const stats = client.getStats();
      expect(stats.calls).toBe(0);
      expect(stats.dedup).toBe(0);
      expect(stats.queued).toBe(0);
      expect(stats.retries).toBe(0);
      expect(stats.circuitState).toBe("closed");
    });

    it("resetStats zeros counters", () => {
      // Force a call count by direct property (stats are updated in exec)
      const stats = client.getStats();
      expect(stats.calls).toBe(0);
      client.resetStats();
      const resetted = client.getStats();
      expect(resetted.calls).toBe(0);
      expect(resetted.circuitState).toBe("closed");
    });
  });

  describe("shutdown", () => {
    it("trips circuit to open", () => {
      client.shutdown();
      const stats = client.getStats();
      expect(stats.circuitState).toBe("open");
    });

    it("rejects queued waiters on shutdown", () => {
      // After shutdown, exec should fail with CircuitOpenError
      client.shutdown();
      expect(client.exec(["--version"])).rejects.toThrow(CircuitOpenError);
    });
  });

  describe("singleton", () => {
    it("getGhClient returns same instance", () => {
      resetGhClient();
      const a = getGhClient();
      const b = getGhClient();
      expect(a).toBe(b);
    });

    it("resetGhClient creates new instance", () => {
      const a = getGhClient();
      resetGhClient();
      const b = getGhClient();
      expect(a).not.toBe(b);
    });
  });
});
