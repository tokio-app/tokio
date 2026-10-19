import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
} from "@/common/types";
import { contextBridge, ipcRenderer } from "@test/electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@electron-toolkit/preload", () => ({
  electronAPI: { toolkit: true },
}));

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

// Runs the preload script as Electron does, in a page with or without
// context isolation. Its window is returned for the second case.
async function load(contextIsolated: boolean) {
  vi.resetModules();
  Object.defineProperty(process, "contextIsolated", {
    value: contextIsolated,
    configurable: true,
  });
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
  afterEach(() => {
    Reflect.deleteProperty(process, "contextIsolated");
  });

  it("exposes electron and the api to an isolated page", async () => {
    const window = await load(true);

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith("electron", {
      toolkit: true,
    });
    expect(exposed()).toBeDefined();
    expect(window).toEqual({});
  });

  it("logs instead of throwing when the bridge refuses", async () => {
    const failure = new Error("Bridge closed");
    contextBridge.exposeInMainWorld.mockImplementation(() => {
      throw failure;
    });

    await expect(load(true)).resolves.toBeDefined();

    expect(console.error).toHaveBeenCalledWith(failure);
  });

  it("puts both on the window of a page without isolation", async () => {
    const window = await load(false);

    expect(window.electron).toEqual({ toolkit: true });
    expect(isApi(window.api)).toBe(true);
    expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
  });

  it("sends a request with its data", async () => {
    await load(true);

    exposed().emit(APP_EVENTS.SET_PROFILE, { file: "stream.json" });

    expect(ipcRenderer.send).toHaveBeenCalledWith(APP_EVENTS.SET_PROFILE, {
      file: "stream.json",
    });
  });

  it("passes listeners only the data of a reply", async () => {
    await load(true);
    const callback = vi.fn();

    exposed().on(APP_EVENTS_RESPONSE.LIKES, callback);
    ipcRenderer.emit(APP_EVENTS_RESPONSE.LIKES, { sender: {} }, { likes: 4 });

    expect(callback).toHaveBeenCalledExactlyOnceWith({ likes: 4 });
  });

  it("removes only the subscription it returned", async () => {
    await load(true);
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
