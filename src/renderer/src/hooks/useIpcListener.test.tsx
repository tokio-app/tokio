import { APP_EVENTS_RESPONSE } from "@/common/types";
import { listeners, send } from "@test/ipc";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIpcListener } from "./useIpcListener";

const { LIKES, VIEWS } = APP_EVENTS_RESPONSE;

describe("useIpcListener", () => {
  it("hands main's data to the latest callback", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(
      ({ callback }) => useIpcListener(LIKES, callback),
      { initialProps: { callback: first } },
    );

    rerender({ callback: latest });
    await send(LIKES, { likes: 3 });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({ likes: 3 });
    // A new callback doesn't subscribe again
    expect(listeners(LIKES)).toBe(1);
  });

  it("moves to a new event", async () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ event }) => useIpcListener(event, callback),
      { initialProps: { event: LIKES as APP_EVENTS_RESPONSE } },
    );

    rerender({ event: VIEWS });
    await send(LIKES, { likes: 3 });

    expect(listeners(LIKES)).toBe(0);
    expect(listeners(VIEWS)).toBe(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", async () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useIpcListener(LIKES, callback));

    unmount();
    await send(LIKES, { likes: 3 });

    expect(listeners(LIKES)).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });
});
