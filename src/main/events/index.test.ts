import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import Handler from "@/handler";
import { createWindow } from "@/services/music/common";
import { ipcMain, views } from "@test/electron";
import { createHandler } from "@test/handler";
import { describe, expect, it } from "vitest";
import events from "./index";

// Main's listeners for each channel: the Handler's on ipcMain, and the music
// window's title bar controls on its nav view.
async function listeners() {
  const h = createHandler();
  const handler = new Handler(h.handler);
  await handler.init(events);
  createWindow();
  const nav = views()[0].webContents.ipc;
  return (channel: string) =>
    ipcMain.listenerCount(channel) + nav.listenerCount(channel);
}

const duplicates = (values: string[]) =>
  values.filter((value, i) => values.indexOf(value) !== i);

describe("IPC contract", () => {
  it("listens to every request exactly once", async () => {
    const count = await listeners();

    const wrong = Object.values(APP_EVENTS)
      .map((channel) => ({ channel, listeners: count(channel) }))
      .filter(({ listeners }) => listeners !== 1);

    expect(wrong).toEqual([]);
  });

  it.each([
    ["request", Object.values(APP_EVENTS)],
    ["response", Object.values(APP_EVENTS_RESPONSE)],
  ])("gives every %s its own app: channel", (_, channels) => {
    expect(duplicates(channels)).toEqual([]);
    expect(channels.filter((channel) => !channel.startsWith("app:"))).toEqual(
      [],
    );
  });
});
