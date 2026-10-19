import { APP_EVENTS, APP_EVENTS_RESPONSE, LiveSession } from "@/common/types";
import { createAlert } from "@/pages/Alerts/helper";
import {
  liveSession,
  profileReply,
  settingsReply,
  viewer,
} from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { renderApp } from "@test/render";
import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const connected = (stats = { views: 1234, viewers: 12, likes: 5 }) =>
  send(APP_EVENTS_RESPONSE.CONNECTED, { success: true, stats });

const disconnected = () =>
  send(APP_EVENTS_RESPONSE.CONNECTED, {
    success: false,
    stats: { views: 0, viewers: 0, likes: 0 },
  });

const session = (patch: Partial<LiveSession> = {}) =>
  send(APP_EVENTS_RESPONSE.LIVE_SESSION, { data: liveSession(patch) });

const page = () => within(screen.getByRole("main"));
const username = () => page().getByPlaceholderText("@username");
// The value shown above a stat's label
const stat = (label: string) => page().getByText(label).previousElementSibling;
// "Offline", or "LIVE" and how long
const status = () => page().getByText(/^(Offline|LIVE)/);
const events = () =>
  within(page().getByRole("list", { name: "Activity" })).getAllByRole(
    "listitem",
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("Home", () => {
  it("asks main for the profile, the settings, the connection, the music and the LIVE", async () => {
    await renderApp();

    expect(sentEvents()).toEqual(
      expect.arrayContaining([
        APP_EVENTS.GET_PROFILE,
        APP_EVENTS.GET_SETTINGS,
        APP_EVENTS.IS_CONNECTED,
        APP_EVENTS.IS_MUSIC_CONNECTED,
        APP_EVENTS.GET_LIVE_SESSION,
      ]),
    );
  });

  it("fills in the saved username and features", async () => {
    await renderApp();

    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.connector.username = "@streamer";
      }),
    );
    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.activeFeatures = { tts: true, music: false, alerts: true };
      }),
    );

    expect(username()).toHaveValue("@streamer");
    expect(page().getByRole("checkbox", { name: "TTS" })).toBeChecked();
    expect(page().getByRole("checkbox", { name: "Music" })).not.toBeChecked();
    expect(page().getByRole("checkbox", { name: "Alerts" })).toBeChecked();
  });

  it("connects with the username, loading until main answers", async () => {
    const { user } = await renderApp();
    const connect = page().getByRole("button", { name: "Connect" });

    await user.type(username(), "@streamer");
    await user.click(connect);

    expect(sent(APP_EVENTS.CONNECT)).toEqual([{ username: "@streamer" }]);
    expect(connect).toHaveAttribute("aria-busy", "true");

    await connected();

    expect(status()).toHaveTextContent("LIVE");
    expect(username()).toBeDisabled();
    expect(
      page().getByRole("button", { name: "Disconnect" }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("doesn't connect without a username", async () => {
    const { user } = await renderApp();
    const connect = page().getByRole("button", { name: "Connect" });

    await user.click(connect);
    await user.type(username(), "@ ");
    await user.click(connect);

    expect(sent(APP_EVENTS.CONNECT)).toEqual([]);
    expect(connect).not.toHaveAttribute("aria-busy");
  });

  it("disconnects, loading until main answers", async () => {
    const { user } = await renderApp();
    await connected();

    await user.click(page().getByRole("button", { name: "Disconnect" }));
    expect(sent(APP_EVENTS.DISCONNECT)).toHaveLength(1);

    await disconnected();

    expect(status()).toHaveTextContent("Offline");
    expect(username()).toBeEnabled();
    expect(page().getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("counts how long the LIVE has been on", async () => {
    vi.useFakeTimers({ now: 100_000 });
    await renderApp();
    await connected();

    await session({ startedAt: 100_000 - 65_000 });
    expect(status()).toHaveTextContent("LIVE · 00:01:05");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(status()).toHaveTextContent("LIVE · 00:01:07");

    await disconnected();
    await session();
    expect(status()).toHaveTextContent(/^Offline$/);
  });

  it("turns features on and off", async () => {
    const { user } = await renderApp();
    const music = page().getByRole("checkbox", { name: "Music" });

    await user.click(music);
    expect(music).toBeChecked();

    await user.click(music);
    expect(music).not.toBeChecked();

    expect(sent(APP_EVENTS.ACTIVE_FEATURES)).toEqual([
      { music: true },
      { music: false },
    ]);
  });

  it("shows dashes for the stats while offline", async () => {
    await renderApp();
    await session({
      totals: { followers: 3, shares: 2, gifts: 1, coins: 1 },
    });

    for (const label of [
      "Viewers",
      "Likes",
      "Total views",
      "New followers",
      "Shares",
      "Gifts",
      "Coins",
    ]) {
      expect(stat(label)).toHaveTextContent("--");
    }
  });

  it("shows the live stats short, with the exact number on hover", async () => {
    await renderApp();
    await connected();

    expect(stat("Viewers")).toHaveTextContent("12");
    expect(stat("Likes")).toHaveTextContent("5");
    expect(stat("Total views")).toHaveTextContent("1.2K");
    expect(stat("Total views")).toHaveAttribute("title", "1,234");

    await send(APP_EVENTS_RESPONSE.VIEWS, {
      data: { viewers: 40, views: 2000 },
    });
    await send(APP_EVENTS_RESPONSE.LIKES, { likes: 99 });

    expect(stat("Viewers")).toHaveTextContent("40");
    expect(stat("Total views")).toHaveTextContent("2K");
    expect(stat("Likes")).toHaveTextContent("99");
  });

  it("shows what the LIVE brought since connecting", async () => {
    await renderApp();
    await connected();

    await session({
      startedAt: Date.now(),
      totals: { followers: 3, shares: 2, gifts: 1500, coins: 12_000 },
    });

    expect(stat("New followers")).toHaveTextContent("3");
    expect(stat("Shares")).toHaveTextContent("2");
    expect(stat("Gifts")).toHaveTextContent("1.5K");
    expect(stat("Coins")).toHaveTextContent("12K");
    expect(stat("Coins")).toHaveAttribute("title", "12,000");
  });

  describe("activity", () => {
    it("lists the LIVE's events, newest first", async () => {
      await renderApp();
      await connected();

      await session({
        startedAt: Date.now(),
        activity: [
          {
            id: 6,
            type: "join",
            users: [viewer("kai"), viewer("yui")],
            count: 5,
          },
          {
            id: 5,
            type: "gift",
            user: viewer("mia"),
            gift: { name: "Rose", image: "rose.png", count: 5, coins: 5 },
          },
          {
            id: 4,
            type: "chat",
            user: viewer("kenji"),
            text: "hello from Osaka",
            emotes: ["wave.png"],
          },
          { id: 3, type: "superfan", user: viewer("yui") },
          { id: 2, type: "share", user: viewer("ren") },
          { id: 1, type: "follow", user: viewer("sora") },
        ],
      });

      expect(events().map((event) => event.textContent)).toEqual([
        "kai, yui and 3 others joined",
        "mia sent Rose ×5 5 coins",
        "kenji hello from Osaka",
        "yui became a Super Fan",
        "ren shared the LIVE",
        "sora followed you",
      ]);
      expect(within(events()[1]).getByText("mia")).toHaveAttribute(
        "title",
        "@mia",
      );
    });

    it("leaves the count out of a single gift", async () => {
      await renderApp();

      await session({
        activity: [
          {
            id: 1,
            type: "gift",
            user: viewer("hana"),
            gift: {
              name: "Galaxy",
              image: "galaxy.png",
              count: 1,
              coins: 1000,
            },
          },
        ],
      });

      expect(events()[0].textContent).toBe("hana sent Galaxy 1,000 coins");
    });

    it.each([
      [[viewer("kai")], 1, "kai joined"],
      [[viewer("kai"), viewer("yui")], 2, "kai and yui joined"],
      [[viewer("kai"), viewer("yui")], 3, "kai, yui and 1 other joined"],
    ])("names who joined: %#", async (users, count, text) => {
      await renderApp();

      await session({ activity: [{ id: 1, type: "join", users, count }] });

      expect(events()[0]).toHaveTextContent(text);
    });

    it("shows a viewer's initial when TikTok sent no picture", async () => {
      await renderApp();

      await session({
        activity: [
          {
            id: 1,
            type: "follow",
            user: { handle: "sora", name: "sora", picture: "" },
          },
        ],
      });

      expect(events()[0].querySelector("img")).toBeNull();
      expect(within(events()[0]).getByText("S")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it("says what it shows before connecting", async () => {
      await renderApp();

      expect(
        page().getByText(
          "Chats, gifts and follows show up here once you're connected.",
        ),
      ).toBeInTheDocument();
    });

    it("says it's waiting while the LIVE is quiet", async () => {
      await renderApp();
      await connected();
      await session({ startedAt: Date.now() });

      expect(
        page().getByText("Waiting for the first event…"),
      ).toBeInTheDocument();
    });
  });

  describe("features", () => {
    const featureRow = (name: string) =>
      page().getByRole("checkbox", { name }).closest("li")!;

    it("names the TTS voice", async () => {
      await renderApp();

      await send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.tts.voice = { engine: "Edge", name: "Aria", lang: "en-US" };
        }),
      );

      expect(featureRow("TTS")).toHaveTextContent("Voice: Aria");
    });

    it("says whether music is connected, as a warning while Music is on", async () => {
      await renderApp();
      await send(
        APP_EVENTS_RESPONSE.GET_SETTINGS,
        settingsReply((s) => {
          s.settings.activeFeatures.music = true;
        }),
      );

      // Module class names are hashed in tests
      const warned = (text: string) =>
        within(featureRow("Music"))
          .getByText(text)
          .className.includes("feature_warn");

      expect(warned("YouTube · not connected")).toBe(true);

      await send(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, { success: true });

      expect(warned("YouTube · connected")).toBe(false);
    });

    it("counts the alerts that are on", async () => {
      await renderApp();
      expect(featureRow("Alerts")).toHaveTextContent("No alerts yet");

      await send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.alerts.items = [
            createAlert(),
            { ...createAlert(), enabled: false },
          ];
        }),
      );

      expect(featureRow("Alerts")).toHaveTextContent("1 of 2 alerts on");
    });

    it("opens a feature's page", async () => {
      const { user, router } = await renderApp();

      await user.click(page().getByRole("link", { name: "Go to TTS" }));

      expect(router.state.location.pathname).toBe("/tts");
    });

    it("sends to Settings while the overlay server is off", async () => {
      await renderApp();

      expect(page().getByText("Off · turn it on in Settings")).toBeVisible();
      expect(
        page().getByRole("link", { name: "Go to Settings" }),
      ).toHaveAttribute("href", "/settings");
    });

    it("counts the overlays while the server runs", async () => {
      await renderApp();

      await send(
        APP_EVENTS_RESPONSE.GET_SETTINGS,
        settingsReply((s) => {
          s.settings.server.enabled = true;
          s.settings.overlays = [
            {
              id: "gift-jar",
              name: "Gift Jar",
              version: "1.0.0",
              config: true,
            },
            { id: "clock", name: "Clock", version: "1.0.0", config: false },
          ];
        }),
      );

      expect(page().getByText("Running · 2 overlays")).toBeVisible();
      expect(
        page().getByRole("link", { name: "Go to Overlays" }),
      ).toHaveAttribute("href", "/overlays");
    });
  });
});
