import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { notification, profileReply, settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { renderApp } from "@test/render";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sidebar = () => within(screen.getByRole("navigation"));
// Sections have headers too, the title bar's comes first
const titleBar = () => within(screen.getAllByRole("banner")[0]);

const profiles = settingsReply((s) => {
  s.profiles = [
    { file: "default.json", name: "Default" },
    { file: "horror.json", name: "Horror" },
  ];
  s.settings.activeProfile = { file: "default.json", name: "Default" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Layout", () => {
  it("links every page from the sidebar", async () => {
    await renderApp();

    const links = sidebar()
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Home", "/"],
      ["Overlays", "/overlays"],
      ["TTS", "/tts"],
      ["Alerts", "/alerts"],
      ["Music", "/music"],
      ["Tools", "/tools"],
      ["About", "/about"],
      ["Settings", "/settings"],
    ]);
  });

  it("marks the page that's open", async () => {
    await renderApp("/tts");

    expect(sidebar().getByRole("link", { name: "TTS" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(sidebar().getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps Overlays marked on Official Overlays", async () => {
    await renderApp("/overlays/official");

    expect(
      screen.getByRole("heading", { name: "Official Overlays" }),
    ).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Overlays" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("moves between pages", async () => {
    const { user, router } = await renderApp();
    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();

    await user.click(sidebar().getByRole("link", { name: "Tools" }));

    expect(
      await screen.findByRole("heading", { name: "Test Overlays" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/tools");
  });

  it("saves a change still waiting when leaving a page", async () => {
    const { user, router } = await renderApp("/tts");
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    await user.click(screen.getByRole("button", { name: "Add Replacement" }));

    await user.click(sidebar().getByRole("link", { name: "Home" }));

    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(
      sent(APP_EVENTS.UPDATE_TTS_SETTINGS).map((s) => s.settings.replacements),
    ).toEqual([[{ old: "", new: "" }]]);
  });

  it("switches profiles from the title bar", async () => {
    const { user } = await renderApp();
    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, profiles);

    await user.click(titleBar().getByText("Default"));
    await user.click(titleBar().getByText("Horror"));

    expect(sent(APP_EVENTS.SET_PROFILE)).toEqual([{ file: "horror.json" }]);
  });

  // Sent after the switch, main would save it into the new profile. Timers
  // are stopped, so only the switch can have sent it.
  it("saves a change still waiting before switching profiles", async () => {
    vi.useFakeTimers();
    const { user } = await renderApp("/tts", {
      user: { advanceTimers: (ms) => vi.advanceTimersByTime(ms) },
    });
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, profiles);
    await user.click(screen.getByRole("button", { name: "Add Replacement" }));

    await user.click(titleBar().getByText("Default"));
    await user.click(titleBar().getByText("Horror"));

    expect(
      sentEvents().filter(
        (event) =>
          event === APP_EVENTS.UPDATE_TTS_SETTINGS ||
          event === APP_EVENTS.SET_PROFILE,
      ),
    ).toEqual([APP_EVENTS.UPDATE_TTS_SETTINGS, APP_EVENTS.SET_PROFILE]);
    expect(
      sent(APP_EVENTS.UPDATE_TTS_SETTINGS)[0].settings.replacements,
    ).toEqual([{ old: "", new: "" }]);
  });

  it("locks the profile while connected", async () => {
    const { user } = await renderApp();
    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, profiles);
    await send(APP_EVENTS_RESPONSE.CONNECTED, {
      success: true,
      stats: { views: 0, viewers: 0, likes: 0 },
    });

    await user.click(titleBar().getByText("Default"));

    expect(titleBar().queryByText("Horror")).not.toBeInTheDocument();
  });

  it("shows LIVE in the title bar while connected, on any page", async () => {
    await renderApp("/settings");
    expect(titleBar().queryByText("LIVE")).not.toBeInTheDocument();

    const stats = { views: 0, viewers: 0, likes: 0 };
    await send(APP_EVENTS_RESPONSE.CONNECTED, { success: true, stats });
    expect(titleBar().getByText("LIVE")).toBeInTheDocument();

    // Main sends this when the LIVE ends, is lost, or the user disconnects
    await send(APP_EVENTS_RESPONSE.CONNECTED, { success: false, stats });
    expect(titleBar().queryByText("LIVE")).not.toBeInTheDocument();
  });

  it("shows the update button once an update is ready", async () => {
    await renderApp();
    expect(
      screen.queryByRole("button", { name: /Restart to update/ }),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.UPDATE_STATUS, {
      state: "ready",
      version: "1.2.0",
    });

    expect(
      screen.getByRole("button", { name: /Restart to update/ }),
    ).toBeInTheDocument();
  });

  it("keeps main's notices in the bell", async () => {
    const { user } = await renderApp();

    await send(
      APP_EVENTS_RESPONSE.NOTIFY,
      notification("Profile saved.", { level: "success" }),
    );
    await user.click(screen.getByRole("button", { name: "Notifications" }));

    // The toast and the bell's list
    expect(screen.getAllByText("Profile saved.")).toHaveLength(2);
  });

  it("resumes the audio context when it mounts", async () => {
    const { audio } = await renderApp();

    expect(audio.value.resumeContext).toHaveBeenCalled();
  });
});
