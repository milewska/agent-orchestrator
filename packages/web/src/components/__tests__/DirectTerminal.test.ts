import { describe, it, expect } from "vitest";
import { buildDirectTerminalWsUrl } from "@/components/DirectTerminal";
import { buildTerminalTheme } from "@/components/TerminalTheme";

describe("buildDirectTerminalWsUrl", () => {
  it("keeps non-standard port when proxy path override is set", () => {
    const wsUrl = buildDirectTerminalWsUrl({
      location: {
        protocol: "https:",
        hostname: "example.com",
        host: "example.com:8443",
        port: "8443",
      },
      sessionId: "session-1",
      proxyWsPath: "/ao-terminal-ws",
    });

    expect(wsUrl).toBe("wss://example.com:8443/ao-terminal-ws?session=session-1");
  });

  it("uses proxy path without port when default port is used", () => {
    const wsUrl = buildDirectTerminalWsUrl({
      location: {
        protocol: "https:",
        hostname: "example.com",
        host: "example.com",
        port: "",
      },
      sessionId: "session-2",
      proxyWsPath: "/ao-terminal-ws",
    });

    expect(wsUrl).toBe("wss://example.com/ao-terminal-ws?session=session-2");
  });

  it("uses default path-based endpoint on standard ports when no proxy override is set", () => {
    const wsUrl = buildDirectTerminalWsUrl({
      location: {
        protocol: "https:",
        hostname: "example.com",
        host: "example.com",
        port: "443",
      },
      sessionId: "session-3",
    });

    expect(wsUrl).toBe("wss://example.com/ao-terminal-ws?session=session-3");
  });

  it("uses direct terminal port on non-standard ports when no proxy override is set", () => {
    const wsUrl = buildDirectTerminalWsUrl({
      location: {
        protocol: "http:",
        hostname: "localhost",
        host: "localhost:3000",
        port: "3000",
      },
      sessionId: "session-4",
      directTerminalPort: "14888",
    });

    expect(wsUrl).toBe("ws://localhost:14888/ws?session=session-4");
  });
});

describe("buildTerminalTheme", () => {
  it("agent theme has valid hex colors for bg and fg", () => {
    const theme = buildTerminalTheme("agent");
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(theme.background).toMatch(hexRe);
    expect(theme.foreground).toMatch(hexRe);
  });

  it("theme background is #0a0a0f", () => {
    const theme = buildTerminalTheme("agent");
    expect(theme.background).toBe("#0a0a0f");
  });

  it("variant changes cursor color between agent and orchestrator", () => {
    const agent = buildTerminalTheme("agent");
    const orch = buildTerminalTheme("orchestrator");
    expect(agent.cursor).not.toBe(orch.cursor);
  });
});
