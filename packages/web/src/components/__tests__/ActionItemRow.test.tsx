import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActionItemRow } from "../ActionItemRow";
import { makeSession, makePR } from "../../__tests__/helpers";
import type { PortfolioActionItem } from "@/lib/types";

function makeItem(overrides: Partial<PortfolioActionItem> = {}): PortfolioActionItem {
  return {
    session: makeSession(),
    projectId: "my-app",
    projectName: "My App",
    attentionLevel: "working",
    triageRank: 4,
    ...overrides,
  };
}

describe("ActionItemRow", () => {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onKill = vi.fn().mockResolvedValue(undefined);
  const onMerge = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders session id, project name, and status text", () => {
    const item = makeItem({ attentionLevel: "respond" });
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={onMerge} />,
    );

    expect(screen.getByText(item.session.id.slice(0, 8))).toBeInTheDocument();
    expect(screen.getByText("My App")).toBeInTheDocument();
    expect(screen.getByText("Needs input")).toBeInTheDocument();
  });

  it("renders correct status text for each attention level", () => {
    const levels = [
      { level: "respond" as const, text: "Needs input" },
      { level: "review" as const, text: "Needs review" },
      { level: "merge" as const, text: "Ready to merge" },
      { level: "pending" as const, text: "Waiting" },
      { level: "working" as const, text: "Working" },
      { level: "done" as const, text: "Done" },
    ];

    for (const { level, text } of levels) {
      const { unmount } = render(
        <ActionItemRow
          item={makeItem({ attentionLevel: level })}
          onSend={onSend}
          onKill={onKill}
          onMerge={onMerge}
        />,
      );
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows Send and Kill buttons for non-done items", () => {
    render(
      <ActionItemRow
        item={makeItem({ attentionLevel: "working" })}
        onSend={onSend}
        onKill={onKill}
        onMerge={onMerge}
      />,
    );

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kill" })).toBeInTheDocument();
  });

  it("hides Send and Kill buttons for done items", () => {
    render(
      <ActionItemRow
        item={makeItem({ attentionLevel: "done" })}
        onSend={onSend}
        onKill={onKill}
        onMerge={onMerge}
      />,
    );

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kill" })).not.toBeInTheDocument();
  });

  it("shows Merge button when attentionLevel is merge and PR exists", () => {
    const item = makeItem({
      attentionLevel: "merge",
      session: makeSession({ pr: makePR() }),
    });
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={onMerge} />,
    );

    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
  });

  it("does not show Merge button when attentionLevel is merge but no PR", () => {
    const item = makeItem({ attentionLevel: "merge" });
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={onMerge} />,
    );

    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
  });

  it("calls onMerge with PR number when Merge is clicked", async () => {
    const pr = makePR({ number: 42 });
    const item = makeItem({
      attentionLevel: "merge",
      session: makeSession({ pr }),
    });
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={onMerge} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(onMerge).toHaveBeenCalledWith(42);
    });
  });

  it("calls onKill with session id when Kill is clicked", async () => {
    const item = makeItem();
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={onMerge} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    await waitFor(() => {
      expect(onKill).toHaveBeenCalledWith(item.session.id);
    });
  });

  it("toggles inline message input when Send is clicked", () => {
    render(
      <ActionItemRow
        item={makeItem()}
        onSend={onSend}
        onKill={onKill}
        onMerge={onMerge}
      />,
    );

    // Initially no textarea
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // Click Send to open input — only one Send button exists at this point
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Now there are two "Send" buttons (row + inline input). The row button
    // is the first one in the DOM.
    const sendButtons = screen.getAllByRole("button", { name: "Send" });
    fireEvent.click(sendButtons[0]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows loading state on Merge button while merging", async () => {
    let resolveMerge: () => void;
    const slowMerge = vi.fn(
      () => new Promise<void>((resolve) => { resolveMerge = resolve; }),
    );
    const item = makeItem({
      attentionLevel: "merge",
      session: makeSession({ pr: makePR() }),
    });
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={slowMerge} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(screen.getByText("Merging\u2026")).toBeInTheDocument();

    resolveMerge!();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
    });
  });

  it("shows loading state on Kill button while killing", async () => {
    let resolveKill: () => void;
    const slowKill = vi.fn(
      () => new Promise<void>((resolve) => { resolveKill = resolve; }),
    );
    render(
      <ActionItemRow
        item={makeItem()}
        onSend={onSend}
        onKill={slowKill}
        onMerge={onMerge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    expect(screen.getByText("Killing\u2026")).toBeInTheDocument();

    resolveKill!();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Kill" })).toBeInTheDocument();
    });
  });

  it("renders a link to the project session page", () => {
    const item = makeItem();
    render(
      <ActionItemRow item={item} onSend={onSend} onKill={onKill} onMerge={onMerge} />,
    );

    const link = screen.getByText(item.session.id.slice(0, 8));
    expect(link.closest("a")).toHaveAttribute(
      "href",
      `/projects/${encodeURIComponent(item.projectId)}?session=${encodeURIComponent(item.session.id)}`,
    );
  });
});
