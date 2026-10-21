import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
} from "@/common/types";
import { contextBridge, ipcRenderer } from "@test/electron";
import { describe, expect, it, vi } from "vitest";

type Api = {
  on: <T extends APP_EVENTS_RESPONSE>(
    event: T,
    callback: (data: AppEventsResponseMap[T]) => void,
  ) => () => void;
  emit: <T extends APP_EVENTS>(event: T, data: AppEventsMap[T]) => void;
};

const isApi = (value: unknown): value is Api =>
  typeof value === "object" &&
  value !== null &&
  "on" in value &&
  typeof value.on === "function" &&
  "emit" in value &&
  typeof value.emit === "function";

// Runs the preload script as Electron does, in an isolated page, and
// returns the page's window.
async function load() {
  vi.resetModules();
  const window: Record<string, unknown> = {};
  vi.stubGlobal("window", window);
  await import("./index");
  return window;
}

// The api the script exposed through the context bridge
function exposed(): Api {
  const call = contextBridge.exposeInMainWorld.mock.calls.find(
    ([key]) => key === "api",
  );
  if (!isApi(call?.[1])) throw new Error("The api wasn't exposed.");
  return call[1];
}

describe("preload", () => {
  it("exposes only the api to an isolated page", async () => {
    const window = await load();

    expect(
      contextBridge.exposeInMainWorld.mock.calls.map(([key]) => key),
    ).toEqual(["api"]);
    expect(exposed()).toBeDefined();
    expect(window).toEqual({});
  });

  it("logs instead of throwing when the bridge refuses", async () => {
    const failure = new Error("Bridge closed");
    contextBridge.exposeInMainWorld.mockImplementation(() => {
      throw failure;
    });

    await expect(load()).resolves.toBeDefined();

    expect(console.error).toHaveBeenCalledWith(failure);
  });

  it("sends a request with its data", async () => {
    await load();

    exposed().emit(APP_EVENTS.SET_PROFILE, { file: "stream.json" });

    expect(ipcRenderer.send).toHaveBeenCalledWith(APP_EVENTS.SET_PROFILE, {
      file: "stream.json",
    });
  });

  it("passes listeners only the data of a reply", async () => {
    await load();
    const callback = vi.fn();

    exposed().on(APP_EVENTS_RESPONSE.LIKES, callback);
    ipcRenderer.emit(APP_EVENTS_RESPONSE.LIKES, { sender: {} }, { likes: 4 });

    expect(callback).toHaveBeenCalledExactlyOnceWith({ likes: 4 });
  });

  it("removes only the subscription it returned", async () => {
    await load();
    const api = exposed();
    const callback = vi.fn();

    const unsubscribe = api.on(APP_EVENTS_RESPONSE.LIKES, callback);
    api.on(APP_EVENTS_RESPONSE.LIKES, callback);
    unsubscribe();
    ipcRenderer.emit(APP_EVENTS_RESPONSE.LIKES, {}, { likes: 1 });

    expect(callback).toHaveBeenCalledOnce();
    expect(ipcRenderer.listenerCount(APP_EVENTS_RESPONSE.LIKES)).toBe(1);
  });
});
