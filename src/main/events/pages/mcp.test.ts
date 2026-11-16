import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { flushWindow } from "@/mcp/common";
import { createHandler } from "@test/handler";
import { afterEach, describe, expect, it, vi } from "vitest";
import mcp from "./mcp";

describe("SETTINGS_FLUSHED", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the wait of its flush", async () => {
    // Its timeout never comes: only the answer ends the wait
    vi.useFakeTimers();
    const h = createHandler();
    const flushed = flushWindow(h.handler);
    const [{ id }] = h.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS);

    await h.invoke(mcp, APP_EVENTS.SETTINGS_FLUSHED, { id });

    await flushed;
    expect(h.notices).toEqual([]);
  });
});
