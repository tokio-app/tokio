import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { cancelableEvent, ipcMain, views, windows } from "@test/electron";
import { WebContentsView } from "electron";
import { normalize, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { createWindow } from "./index";

// The last `count` segments of a path, whatever the platform's separator
const tail = (file: unknown, count: number) =>
  typeof file === "string" ? normalize(file).split(sep).slice(-count) : [];

const open = () => {
  const win = createWindow(new WebContentsView());
  const shell = windows().at(-1)!;
  const [content, nav] = views().slice(-2);
  return { win, shell, nav, content };
};

const RESIZE: string = APP_EVENTS_RESPONSE.RESIZE_MUSIC_WINDOW;

const states = (nav: ReturnType<typeof open>["nav"]) =>
  nav.webContents.send.mock.calls
    .filter(([channel]) => channel === RESIZE)
    .map(([, data]) => data);

describe("createWindow", () => {
  it("creates a hidden 1280x840 window", () => {
    const { win, shell } = open();

    expect(win).toBe(shell);
    expect(shell.options).toMatchObject({ width: 1280, height: 840 });
    expect(shell.isVisible()).toBe(false);
  });

  it("adds a title bar view with the preload that loads the music UI", () => {
    const { shell, nav, content } = open();

    expect(shell.contentView.children).toEqual([nav, content]);
    expect(tail(nav.options.webPreferences?.preload, 2)).toEqual([
      "preload",
      "index.mjs",
    ]);
    // Isolated, as Electron's default, like the main window
    expect(nav.options.webPreferences).not.toHaveProperty("contextIsolation");
    expect(nav.webContents.loadFile).toHaveBeenCalledOnce();
    expect(tail(nav.webContents.loadFile.mock.calls[0][0], 2)).toEqual([
      "music-out",
      "index.html",
    ]);
  });

  it("keeps the title bar at the top and the content under it", () => {
    const { shell, nav, content } = open();

    expect(nav.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1280,
      height: 40,
    });
    expect(content.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 40,
      width: 1280,
      height: 800,
    });

    shell.resize(1600, 900);

    expect(nav.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1600,
      height: 40,
    });
    expect(content.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 40,
      width: 1600,
      height: 860,
    });
  });

  it("sends the window state to the title bar on resize, maximize and unmaximize", () => {
    const { shell, nav } = open();

    shell.resize(1300, 850);
    shell.maximize();
    shell.unmaximize();

    expect(states(nav)).toEqual([
      { state: "normal" },
      { state: "maximized" },
      { state: "normal" },
    ]);
  });

  it("keeps the title bar on its page, but lets it reload", () => {
    const { nav } = open();
    const page = nav.webContents.getURL();
    // Whether the title bar may go to the URL
    const navigate = (url: string) => {
      const event = cancelableEvent({ url });
      nav.webContents.emit("will-navigate", event);
      return !event.defaultPrevented;
    };

    expect(navigate("https://example.com/")).toBe(false);
    expect(navigate("file:///C:/x.png")).toBe(false);
    expect(navigate(`${page}#/other`)).toBe(true);
  });

  it("handles the title bar controls on the view, not ipcMain", () => {
    const { shell, nav } = open();

    nav.webContents.ipc.emit(APP_EVENTS.MINIMIZE_MUSIC_WINDOW);
    expect(shell.minimize).toHaveBeenCalledOnce();

    expect(ipcMain.listenerCount(APP_EVENTS.MINIMIZE_MUSIC_WINDOW)).toBe(0);
    expect(ipcMain.listenerCount(APP_EVENTS.MAXIMIZE_MUSIC_WINDOW)).toBe(0);
    expect(ipcMain.listenerCount(APP_EVENTS.CLOSE_MUSIC_WINDOW)).toBe(0);
  });

  it("toggles maximize from the title bar", () => {
    const { shell, nav } = open();

    nav.webContents.ipc.emit(APP_EVENTS.MAXIMIZE_MUSIC_WINDOW);
    expect(shell.isMaximized()).toBe(true);

    nav.webContents.ipc.emit(APP_EVENTS.MAXIMIZE_MUSIC_WINDOW);
    expect(shell.isMaximized()).toBe(false);
    expect(shell.unmaximize).toHaveBeenCalledOnce();
  });

  it("closes the window from the title bar", () => {
    const { shell, nav } = open();

    nav.webContents.ipc.emit(APP_EVENTS.CLOSE_MUSIC_WINDOW);

    expect(shell.isDestroyed()).toBe(true);
  });

  it("only answers its own title bar", () => {
    const first = open();
    const second = open();

    second.nav.webContents.ipc.emit(APP_EVENTS.MAXIMIZE_MUSIC_WINDOW);
    second.nav.webContents.ipc.emit(APP_EVENTS.MINIMIZE_MUSIC_WINDOW);
    second.nav.webContents.ipc.emit(APP_EVENTS.CLOSE_MUSIC_WINDOW);

    expect(second.shell.maximize).toHaveBeenCalledOnce();
    expect(second.shell.minimize).toHaveBeenCalledOnce();
    expect(second.shell.isDestroyed()).toBe(true);
    expect(first.shell.maximize).not.toHaveBeenCalled();
    expect(first.shell.minimize).not.toHaveBeenCalled();
    expect(first.shell.isDestroyed()).toBe(false);
  });

  it("ignores the controls once the window is destroyed", () => {
    const { shell, nav } = open();
    shell.close();

    nav.webContents.ipc.emit(APP_EVENTS.MAXIMIZE_MUSIC_WINDOW);
    nav.webContents.ipc.emit(APP_EVENTS.MINIMIZE_MUSIC_WINDOW);
    nav.webContents.ipc.emit(APP_EVENTS.CLOSE_MUSIC_WINDOW);

    expect(shell.maximize).not.toHaveBeenCalled();
    expect(shell.minimize).not.toHaveBeenCalled();
    expect(shell.close).toHaveBeenCalledOnce();
  });

  it("stops sending the state once the title bar is destroyed", () => {
    const { shell, nav } = open();
    nav.webContents.destroy();

    shell.resize(1300, 850);
    shell.maximize();
    shell.unmaximize();

    expect(nav.webContents.send).not.toHaveBeenCalled();
  });

  it("removes the title bar and closes its page when the window closes", () => {
    const { shell, nav } = open();

    shell.close();

    expect(shell.contentView.removeChildView).toHaveBeenCalledWith(nav);
    expect(shell.contentView.children).not.toContain(nav);
    expect(nav.webContents.close).toHaveBeenCalledOnce();
    expect(nav.webContents.isDestroyed()).toBe(true);
  });
});
