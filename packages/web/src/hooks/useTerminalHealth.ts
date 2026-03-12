"use client";

import { useEffect, useState } from "react";
import type { TerminalTransportHealth } from "@/lib/types";

const REFRESH_INTERVAL_MS = 5_000;

export function useTerminalHealth(initialHealth: TerminalTransportHealth | null = null): {
  terminalHealth: TerminalTransportHealth | null;
} {
  const [terminalHealth, setTerminalHealth] = useState<TerminalTransportHealth | null>(
    initialHealth,
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await fetch("/api/terminal-health");
        if (!res.ok) {
          return;
        }
        const next = (await res.json()) as TerminalTransportHealth;
        if (!cancelled) {
          setTerminalHealth(next);
        }
      } catch {
        return;
      }
    };

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { terminalHealth };
}
