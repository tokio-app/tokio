import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { send, sent } from "@test/ipc";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUpdateStatus } from "./useUpdateStatus";

describe("useUpdateStatus", () => {
  it("starts idle, asks for the status and follows what main pushes", async () => {
    const { result } = renderHook(() => useUpdateStatus());

    expect(result.current).toEqual({ state: "idle" });
    expect(sent(APP_EVENTS.GET_UPDATE_STATUS)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.UPDATE_STATUS, {
      state: "downloading",
      version: "1.2.0",
      percent: 10,
    });
    expect(result.current).toEqual({
      state: "downloading",
      version: "1.2.0",
      percent: 10,
    });

    await send(APP_EVENTS_RESPONSE.UPDATE_STATUS, {
      state: "ready",
      version: "1.2.0",
    });
    expect(result.current).toEqual({ state: "ready", version: "1.2.0" });
  });
});
