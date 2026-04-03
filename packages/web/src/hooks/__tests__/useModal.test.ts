import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useModal } from "../useModal";

describe("useModal", () => {
  it("starts closed by default", () => {
    const { result } = renderHook(() => useModal());
    expect(result.current.isOpen).toBe(false);
  });

  it("starts open when initialOpen is true", () => {
    const { result } = renderHook(() => useModal(true));
    expect(result.current.isOpen).toBe(true);
  });

  it("opens the modal", () => {
    const { result } = renderHook(() => useModal());

    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });

  it("closes the modal", () => {
    const { result } = renderHook(() => useModal(true));

    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it("toggles the modal", () => {
    const { result } = renderHook(() => useModal());

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it("closes on Escape key when open", () => {
    const { result } = renderHook(() => useModal(true));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("does not close on Escape when already closed", () => {
    const { result } = renderHook(() => useModal(false));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("sets body overflow to hidden when open", () => {
    const { result } = renderHook(() => useModal());

    act(() => result.current.open());
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("restores body overflow when closed", () => {
    const { result } = renderHook(() => useModal(true));

    act(() => result.current.close());
    expect(document.body.style.overflow).toBe("");
  });

  it("cleans up event listener and overflow on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { result, unmount } = renderHook(() => useModal(true));
    expect(result.current.isOpen).toBe(true);

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(document.body.style.overflow).toBe("");

    removeEventListenerSpy.mockRestore();
  });
});
