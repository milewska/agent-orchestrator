import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineMessageInput } from "../InlineMessageInput";

describe("InlineMessageInput", () => {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders textarea with placeholder", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} placeholder="Type here..." />,
    );

    expect(screen.getByPlaceholderText("Type here...")).toBeInTheDocument();
  });

  it("uses default placeholder when none provided", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    expect(screen.getByPlaceholderText("Send a message to this session...")).toBeInTheDocument();
  });

  it("focuses the textarea on mount", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("disables Send button when message is empty", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDisabled();
  });

  it("enables Send button when message has content", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("calls onSend with sessionId and trimmed message on button click", async () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  hello world  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("s1", "hello world");
    });
  });

  it("calls onSend on Enter key press (without shift)", async () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("s1", "test message");
    });
  });

  it("does not call onSend on Shift+Enter", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onCancel on Escape key press", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows sending state while message is being sent", async () => {
    let resolveSend: () => void;
    const slowSend = vi.fn(
      () => new Promise<void>((resolve) => { resolveSend = resolve; }),
    );

    render(
      <InlineMessageInput sessionId="s1" onSend={slowSend} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Sending\u2026")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();

    resolveSend!();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    });
  });

  it("shows error message when send fails", async () => {
    const failSend = vi.fn().mockRejectedValue(new Error("fail"));

    render(
      <InlineMessageInput sessionId="s1" onSend={failSend} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to send. Try again.")).toBeInTheDocument();
    });
  });

  it("does not send when message is only whitespace", () => {
    render(
      <InlineMessageInput sessionId="s1" onSend={onSend} onCancel={onCancel} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    // Send button should be disabled for whitespace-only
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
