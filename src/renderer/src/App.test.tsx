import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { notification } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real AudioProvider, without Tone.js: jsdom has no Web Audio
vi.mock("@/helper/audio", () => ({
  AudioQueue: class {
    stop = vi.fn();
    setItemGain = vi.fn();
  },
}));
vi.mock("tone", () => ({
  getContext: () => ({ state: "running" }),
  start: vi.fn(),
}));

// The app at a URL hash, as Electron loads index.html. The router reads the
// hash when it's created, so each test imports a new one.
async function open(hash = "") {
  window.location.hash = hash;
  vi.resetModules();
  const { default: App } = await import("./App");
  render(<App />);
}

describe("App", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("shows the dashboard once main has loaded", async () => {
    await open();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.LOAD_APP, { success: true });

    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(sent(APP_EVENTS.SHOW_WINDOW)).toHaveLength(1);
  });

  it("shows the notices main sends while it loads", async () => {
    await open();

    await send(
      APP_EVENTS_RESPONSE.NOTIFY,
      notification("Unable to get the gifts from TikTok."),
    );

    expect(
      screen.getByText("Unable to get the gifts from TikTok."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("opens the page in the URL's hash", async () => {
    await open("#/about");

    await send(APP_EVENTS_RESPONSE.LOAD_APP, { success: true });

    expect(
      await screen.findByRole("heading", { name: "Online services" }),
    ).toBeInTheDocument();
  });
});
