import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionLevel, DashboardSession } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AttentionZone", () => ({
  AttentionZone: ({ level, sessions }: { level: AttentionLevel; sessions: DashboardSession[] }) => (
    <section data-testid={`zone-${level}`}>
      {sessions.map((session) => (
        <span key={session.id}>{session.id}</span>
      ))}
    </section>
  ),
}));

import { Dashboard } from "../Dashboard";
import { makeSession } from "../../__tests__/helpers";

describe("Dashboard live attention grouping", () => {
  let eventSourceMock: {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    close: () => void;
  };

  beforeEach(() => {
    eventSourceMock = {
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };
    const eventSourceConstructor = vi.fn(() => eventSourceMock as unknown as EventSource);
    global.EventSource = Object.assign(eventSourceConstructor, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSED: 2,
    }) as unknown as typeof EventSource;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          // Keep refresh pending so this test observes the immediate SSE regroup.
        }),
    );
  });

  it("uses SSE attentionLevel to move a card when session fields are otherwise unchanged", async () => {
    const lastActivityAt = new Date().toISOString();
    const initialSessions = [
      makeSession({
        id: "session-1",
        status: "stuck",
        activity: "active",
        lastActivityAt,
      }),
    ];

    render(<Dashboard initialSessions={initialSessions} attentionZones="simple" />);

    expect(within(screen.getByTestId("zone-action")).getByText("session-1")).toBeInTheDocument();

    await act(async () => {
      eventSourceMock.onmessage?.({
        data: JSON.stringify({
          type: "snapshot",
          sessions: [
            {
              id: "session-1",
              status: "stuck",
              activity: "active",
              attentionLevel: "merge",
              lastActivityAt,
            },
          ],
        }),
      } as MessageEvent);
    });

    expect(within(screen.getByTestId("zone-merge")).getByText("session-1")).toBeInTheDocument();
  });
});
