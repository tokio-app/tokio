import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import config from "@/config";
import {
  app,
  cancelableEvent,
  FakeBrowserWindow,
  ipcMain,
  session,
  shell,
} from "@test/electron";
import { createHandler } from "@test/handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHandler } from "./app";

// Fake timers don't reach node:timers/promises, the splash waits with it
vi.mock("node:timers/promises", () => ({
  setTimeout: (ms: number) => new Promise((done) => setTimeout(done, ms)),
}));

const start = () => {
  const h = createHandler();
  void new AppHandler(h.handler).initApp();
  return h;
};

const send = (event: APP_EVENTS) => ipcMain.emit(event, {});

describe("AppHandler", () => {
  describe("splash", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows the splash once it's ready", () => {
      const { splash } = start();

      splash.emit("ready-to-show");

      expect(splash.show).toHaveBeenCalledOnce();
    });

    it("shows the app after SHOW_WINDOW, once the splash was up 2s", async () => {
      const { splash, win } = start();
      splash.emit("ready-to-show");

      await vi.advanceTimersByTimeAsync(500);
      send(APP_EVENTS.SHOW_WINDOW);
      await vi.advanceTimersByTimeAsync(1499);
      expect(win.show).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(win.show).toHaveBeenCalledOnce();
      expect(splash.isDestroyed()).toBe(true);
      expect(win.isDestroyed()).toBe(false);
    });

    it("doesn't wait when the splash was already up 2s", async () => {
      const { splash, win } = start();
      splash.emit("ready-to-show");
      await vi.advanceTimersByTimeAsync(2000);

      send(APP_EVENTS.SHOW_WINDOW);
      await vi.advanceTimersByTimeAsync(0);

      expect(win.show).toHaveBeenCalledOnce();
    });

    it("shows the app once when SHOW_WINDOW comes twice", async () => {
      const { splash, win } = start();
      splash.emit("ready-to-show");

      send(APP_EVENTS.SHOW_WINDOW);
      send(APP_EVENTS.SHOW_WINDOW);
      await vi.advanceTimersByTimeAsync(2000);

      expect(win.show).toHaveBeenCalledOnce();
    });

    it("quits when the splash is closed before the app shows", async () => {
      const { splash, win } = start();
      splash.emit("ready-to-show");
      send(APP_EVENTS.SHOW_WINDOW);

      splash.close();
      await vi.advanceTimersByTimeAsync(2000);

      expect(win.isDestroyed()).toBe(true);
      expect(win.show).not.toHaveBeenCalled();
    });

    it("brings the splash, then the app, to the front on a second launch", async () => {
      const { splash, win } = start();
      splash.emit("ready-to-show");

      app.emit("second-instance");
      expect(splash.focus).toHaveBeenCalledOnce();

      send(APP_EVENTS.SHOW_WINDOW);
      await vi.advanceTimersByTimeAsync(2000);
      win.minimize();
      app.emit("second-instance");

      expect(win.restore).toHaveBeenCalledOnce();
      expect(win.isMinimized()).toBe(false);
      expect(win.focus).toHaveBeenCalledOnce();
    });

    it("keeps the app open when the splash closes after showing it", async () => {
      const { splash, win } = start();
      splash.emit("ready-to-show");
      send(APP_EVENTS.SHOW_WINDOW);
      await vi.advanceTimersByTimeAsync(2000);

      expect(splash.isDestroyed()).toBe(true);
      expect(win.isDestroyed()).toBe(false);
    });
  });

  describe("main window", () => {
    it("minimizes, toggles maximized and closes from the title bar", () => {
      const { win } = start();

      send(APP_EVENTS.MINIMIZE_WINDOW);
      send(APP_EVENTS.MAXIMIZE_WINDOW);
      expect(win.isMaximized()).toBe(true);
      send(APP_EVENTS.MAXIMIZE_WINDOW);
      expect(win.isMaximized()).toBe(false);
      send(APP_EVENTS.CLOSE_WINDOW);

      expect(win.minimize).toHaveBeenCalledOnce();
      expect(win.maximize).toHaveBeenCalledOnce();
      expect(win.unmaximize).toHaveBeenCalledOnce();
      expect(win.isDestroyed()).toBe(true);
    });

    it("tells the title bar whether it's maximized when it resizes", () => {
      const h = start();

      h.win.resize(1300, 900);
      h.win.maximize();
      h.win.emit("resize");

      expect(h.pushed(APP_EVENTS_RESPONSE.RESIZE_WINDOW)).toEqual([
        { state: "normal" },
        { state: "maximized" },
      ]);
    });

    it("closes every other window with it", () => {
      const { win } = start();
      const music = new FakeBrowserWindow();

      win.close();

      expect(music.isDestroyed()).toBe(true);
    });

    it("stays on its page, but lets it reload", () => {
      const { win } = start();
      void win.loadURL("http://localhost:5173/index.html#/settings");
      // Whether the page may go to the URL
      const navigate = (url: string) => {
        const event = cancelableEvent({ url });
        win.webContents.emit("will-navigate", event);
        return !event.defaultPrevented;
      };

      expect(navigate("https://example.com/")).toBe(false);
      expect(navigate("file:///C:/x.png")).toBe(false);
      expect(navigate("http://localhost:5173/index.html#/")).toBe(true);
    });

    it("opens links in the browser instead of a new window", () => {
      const { win } = start();
      const [handler] = win.webContents.setWindowOpenHandler.mock.calls[0];

      const result = handler({ url: "https://tokio.ialfaro.com" });

      expect(result).toEqual({ action: "deny" });
      expect(shell.openExternal).toHaveBeenCalledWith(
        "https://tokio.ialfaro.com",
      );
    });
  });

  describe("session", () => {
    // Runs the page's response through the headers listener
    const headersFor = (url: string) => {
      const [listener] =
        session.defaultSession.webRequest.onHeadersReceived.mock.calls[0];
      const callback = vi.fn();
      listener({ url, responseHeaders: { "X-Test": ["1"] } }, callback);
      return callback.mock.calls[0][0];
    };

    it("sets the development CSP on the app's pages", () => {
      start();

      expect(headersFor("http://localhost:5173/index.html")).toEqual({
        responseHeaders: {
          "X-Test": ["1"],
          "Content-Security-Policy": [config.CSP.dev],
        },
      });
    });

    it("sets the production CSP once packaged", () => {
      app.isPackaged = true;
      start();

      expect(
        headersFor("file:///app/out/renderer/index.html").responseHeaders,
      ).toMatchObject({ "Content-Security-Policy": [config.CSP.prod] });
    });

    it("leaves overlays without a CSP, as in OBS", () => {
      start();

      for (const url of [
        "local-resource:///C:/Users/me/.tokio/overlays/gift-jar/index.html",
        "http://tokio-app.local:37891/gift-jar/",
      ]) {
        expect(headersFor(url)).toEqual({
          responseHeaders: { "X-Test": ["1"] },
        });
      }
    });

    it("blocks the pages' websockets to the overlay server", () => {
      start();
      const [filter, listener] =
        session.defaultSession.webRequest.onBeforeRequest.mock.calls[0];
      const callback = vi.fn();

      listener(
        { url: "ws://localhost:37891/?id=x", resourceType: "webSocket" },
        callback,
      );
      listener(
        { url: "http://localhost:37891/x", resourceType: "script" },
        callback,
      );

      expect(filter).toBe(config.URL_FILTER);
      expect(callback.mock.calls).toEqual([
        [{ cancel: true }],
        [{ cancel: false }],
      ]);
    });
  });
});
