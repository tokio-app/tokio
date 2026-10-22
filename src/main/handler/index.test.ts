import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { settle } from "@/helper/quit";
import Logger from "@/logger";
import { ipcMain } from "@test/electron";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import Handler from "./index";

describe("Handler", () => {
  it("sets up the windows and registers every event of the stack", async () => {
    const h = createHandler();
    const stack = createStack();
    stack.push(APP_EVENTS.GET_SETTINGS, vi.fn());
    stack.push(APP_EVENTS.GET_SOUNDS, vi.fn());

    await new Handler(h.handler).init(stack);

    expect(ipcMain.listenerCount(APP_EVENTS.GET_SETTINGS)).toBe(1);
    expect(ipcMain.listenerCount(APP_EVENTS.GET_SOUNDS)).toBe(1);
    expect(ipcMain.listenerCount(APP_EVENTS.SHOW_WINDOW)).toBe(1);
  });

  it("runs a handler with the services, the event and its data", async () => {
    const h = createHandler();
    const callback = vi.fn();
    const stack = createStack();
    stack.push(APP_EVENTS.SET_PROFILE, callback);
    const handler = new Handler(h.handler);
    await handler.init(stack);
    const event = { reply: vi.fn() };

    ipcMain.emit(APP_EVENTS.SET_PROFILE, event, { file: "stream.json" });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(handler, event, {
        file: "stream.json",
      });
    });
  });

  it("reports a handler that throws and sends its failure reply", async () => {
    vi.spyOn(Logger, "error");
    const h = createHandler();
    const stack = createStack("system");
    stack.push(
      APP_EVENTS.GET_SETTINGS,
      () => {
        throw new Error("store not ready");
      },
      {
        failure: {
          code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
          message: "Unable to load the settings.",
        },
        onError: (e, error) =>
          e.reply(APP_EVENTS_RESPONSE.GET_SETTINGS, { success: false, error }),
      },
    );
    await new Handler(h.handler).init(stack);
    const reply = vi.fn();

    ipcMain.emit(APP_EVENTS.GET_SETTINGS, { reply });

    await vi.waitFor(() => {
      expect(reply).toHaveBeenCalledWith(APP_EVENTS_RESPONSE.GET_SETTINGS, {
        success: false,
        error: expect.objectContaining({
          code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
        }),
      });
    });
    expect(h.notices).toEqual([
      expect.objectContaining({ code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED }),
    ]);
  });

  it("keeps a quit waiting until the handler finishes", async () => {
    const h = createHandler();
    let finish!: () => void;
    const stack = createStack();
    stack.push(
      APP_EVENTS.UPDATE_TTS_SETTINGS,
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    await new Handler(h.handler).init(stack);
    let settled = false;

    ipcMain.emit(APP_EVENTS.UPDATE_TTS_SETTINGS, { reply: vi.fn() }, {});
    const quit = settle(1000).then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    finish();
    await quit;
  });
});
