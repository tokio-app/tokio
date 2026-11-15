import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { AppFailure } from "@/helper/feedback";
import { createStack, type Stack } from "@/helper/events";
import { settle } from "@/helper/quit";
import Logger from "@/logger";
import { ipcMain } from "@test/electron";
import type { ReplyEvent } from "@/types";
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
          message: "main.failure.getSettings",
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

  describe("invoke", () => {
    const profiles = { success: true, profiles: [] };

    async function start(stack: Stack) {
      const h = createHandler();
      const handler = new Handler(h.handler);
      await handler.init(stack);
      return { h, handler };
    }

    it("returns the replies and sends them to the window", async () => {
      const stack = createStack();
      stack.push(APP_EVENTS.GET_PROFILE, (_, e) => {
        e.reply(APP_EVENTS_RESPONSE.GET_PROFILE, profiles);
        e.reply(APP_EVENTS_RESPONSE.GET_SETTINGS, { success: true });
      });
      const { h, handler } = await start(stack);

      const res = await handler.invoke(APP_EVENTS.GET_PROFILE, undefined);

      expect(res).toEqual({
        error: undefined,
        replies: [
          [APP_EVENTS_RESPONSE.GET_PROFILE, profiles],
          [APP_EVENTS_RESPONSE.GET_SETTINGS, { success: true }],
        ],
      });
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([profiles]);
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        { success: true },
      ]);
    });

    it("keeps private replies from the window", async () => {
      const stack = createStack();
      stack.push(APP_EVENTS.CREATE_PROFILE, (_, e) => {
        e.reply(APP_EVENTS_RESPONSE.CREATE_PROFILE, { success: true });
        e.reply(APP_EVENTS_RESPONSE.GET_PROFILE, profiles);
      });
      const { h, handler } = await start(stack);

      const res = await handler.invoke(APP_EVENTS.CREATE_PROFILE, {
        name: "Stream",
      });

      expect(res.replies).toHaveLength(2);
      expect(h.win.webContents.send.mock.calls).toEqual([
        [APP_EVENTS_RESPONSE.GET_PROFILE, profiles],
      ]);
    });

    it("sends a reply after the call to the window without returning it", async () => {
      let kept!: ReplyEvent;
      const stack = createStack();
      stack.push(APP_EVENTS.CONNECT_MUSIC, (_, e) => {
        kept = e;
      });
      const { h, handler } = await start(stack);

      const res = await handler.invoke(APP_EVENTS.CONNECT_MUSIC, {
        name: "youtube",
        key: "",
        block_ads: true,
      });
      kept.reply(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, { success: true });

      expect(res.replies).toEqual([]);
      expect(h.pushed(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
        { success: true },
      ]);
    });

    it("doesn't send to a closed window", async () => {
      const stack = createStack();
      stack.push(APP_EVENTS.GET_PROFILE, (_, e) => {
        e.reply(APP_EVENTS_RESPONSE.GET_PROFILE, profiles);
      });
      const { h, handler } = await start(stack);
      vi.spyOn(h.win, "isDestroyed").mockReturnValue(true);

      const res = await handler.invoke(APP_EVENTS.GET_PROFILE, undefined);

      expect(res.replies).toHaveLength(1);
      expect(h.win.webContents.send).not.toHaveBeenCalled();
    });

    it("returns the error of a failure that only notifies", async () => {
      vi.spyOn(Logger, "warn");
      const stack = createStack();
      stack.push(APP_EVENTS.SET_PROFILE, () => {
        throw new AppFailure(FEEDBACK_CODES.PROFILE_LOCKED, "Disconnect.", {
          level: "warning",
        });
      });
      const { h, handler } = await start(stack);

      const res = await handler.invoke(APP_EVENTS.SET_PROFILE, {
        file: "stream.json",
      });

      const error = {
        code: FEEDBACK_CODES.PROFILE_LOCKED,
        message: "Disconnect.",
      };
      expect(res).toEqual({ error, replies: [] });
      expect(h.notices).toEqual([expect.objectContaining(error)]);
    });

    it("resolves with an error for an event no stack handles", async () => {
      const logError = vi.spyOn(Logger, "error");
      const { h, handler } = await start(createStack());

      const res = await handler.invoke(APP_EVENTS.GET_SOUNDS, undefined);

      expect(res).toEqual({
        error: expect.objectContaining({ code: FEEDBACK_CODES.UNKNOWN }),
        replies: [],
      });
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(APP_EVENTS.GET_SOUNDS),
        "system.log",
      );
      expect(h.notices).toEqual([]);
    });

    it("keeps a quit waiting until the handler finishes", async () => {
      let finish!: () => void;
      const stack = createStack();
      stack.push(
        APP_EVENTS.GET_SOUNDS,
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      const { handler } = await start(stack);
      let settled = false;

      const call = handler.invoke(APP_EVENTS.GET_SOUNDS, undefined);
      const quit = settle(1000).then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);

      finish();
      await Promise.all([call, quit]);
    });

    it("runs in tests from the stack createHandler gets", async () => {
      const stack = createStack();
      stack.push(APP_EVENTS.GET_PROFILE, (_, e) => {
        e.reply(APP_EVENTS_RESPONSE.GET_PROFILE, profiles);
      });
      const h = createHandler({}, { stack });

      const res = await h.handler.invoke(APP_EVENTS.GET_PROFILE, undefined);

      expect(res.replies).toEqual([
        [APP_EVENTS_RESPONSE.GET_PROFILE, profiles],
      ]);
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([profiles]);
    });
  });
});
