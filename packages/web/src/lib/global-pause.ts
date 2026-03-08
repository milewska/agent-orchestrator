export interface GlobalPauseState {
  pausedUntil: string;
  reason: string;
  sourceSessionId: string | null;
}

export function resolveGlobalPause(
  sessions: Array<{ id: string; metadata: Record<string, string> }>,
): GlobalPauseState | null {
  const orchestrator = sessions.find((session) => session.id.endsWith("-orchestrator"));
  const pausedUntil = orchestrator?.metadata["globalPauseUntil"];
  if (!pausedUntil) return null;

  const parsed = new Date(pausedUntil);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;

  return {
    pausedUntil: parsed.toISOString(),
    reason: orchestrator?.metadata["globalPauseReason"] ?? "Model rate limit reached",
    sourceSessionId: orchestrator?.metadata["globalPauseSource"] ?? null,
  };
}
