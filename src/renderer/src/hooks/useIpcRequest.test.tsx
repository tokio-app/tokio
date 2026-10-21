import { APP_EVENTS } from "@/common/types";
import { sent } from "@test/ipc";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIpcRequest } from "./useIpcRequest";

describe("useIpcRequest", () => {
  it("sends the request once, on mount", () => {
    const { rerender } = renderHook(() => useIpcRequest(APP_EVENTS.GET_SOUNDS));
    rerender();

    expect(sent(APP_EVENTS.GET_SOUNDS)).toEqual([undefined]);
  });

  it("sends it once under StrictMode, which runs effects twice", () => {
    renderHook(() => useIpcRequest(APP_EVENTS.GET_PROFILE), {
      reactStrictMode: true,
    });

    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
  });

  it("sends it again for each component that mounts", () => {
    renderHook(() => useIpcRequest(APP_EVENTS.GET_PROFILE));
    renderHook(() => useIpcRequest(APP_EVENTS.GET_PROFILE));

    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(2);
  });
});
