import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Platform,
  PlatformStatus,
} from "@/common/types";
import { liveSession, profileReply, settingsReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const page = () => within(screen.getByRole("main"));
const logo = (name: string) =>
  within(page().getByRole("group", { name: "Platforms" })).getByRole("button", {
    name,
  });
const stat = (label: string) => page().queryByText(label);

const usingPlatforms = (platforms: Platform[]) =>
  send(
    APP_EVENTS_RESPONSE.GET_PROFILE,
    profileReply((p) => {
      p.platforms = platforms;
      p.connector.username = "@streamer";
    }),
  );

const signedIn = (login: string) =>
  send(
    APP_EVENTS_RESPONSE.GET_SETTINGS,
    settingsReply((s) => {
      s.settings.accounts.twitch.login = login;
      s.settings.activeConnProvider.key = "euler-key";
    }),
  );

const live = (platforms: Partial<Record<Platform, PlatformStatus>>) =>
  send(APP_EVENTS_RESPONSE.CONNECTED, {
    success: true,
    live: true,
    platforms,
    stats: { views: 10, viewers: 2, likes: 3 },
  });

describe("Home's platforms", () => {
  it("shows the profile's platforms pressed and toggles them", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok"]);

    expect(logo("TikTok")).toHaveAttribute("aria-pressed", "true");
    // The last one can't go
    expect(logo("TikTok")).toBeDisabled();
    expect(logo("Twitch")).toHaveAttribute("aria-pressed", "false");

    await user.click(logo("Twitch"));

    expect(sent(APP_EVENTS.SET_PLATFORMS)).toEqual([
      { platforms: ["tiktok", "twitch"] },
    ]);
    expect(logo("Twitch")).toHaveAttribute("aria-pressed", "true");
    expect(logo("TikTok")).toBeEnabled();

    await user.click(logo("TikTok"));
    expect(sent(APP_EVENTS.SET_PLATFORMS).at(-1)).toEqual({
      platforms: ["twitch"],
    });
  });

  it("shows what main holds after a change", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok"]);

    await user.click(logo("Twitch"));
    await send(APP_EVENTS_RESPONSE.SET_PLATFORMS, {
      success: false,
      platforms: ["tiktok"],
    });

    expect(logo("Twitch")).toHaveAttribute("aria-pressed", "false");
  });

  it("locks the platforms while main holds a connection", async () => {
    await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);

    await send(APP_EVENTS_RESPONSE.CONNECTED, {
      success: true,
      live: false,
      stats: { views: 0, viewers: 0, likes: 0 },
    });

    expect(logo("TikTok")).toBeDisabled();
    expect(logo("Twitch")).toBeDisabled();
  });

  it("gives Twitch a row with the account, or a link to sign in", async () => {
    await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);

    expect(page().getByPlaceholderText("@username")).toHaveValue("@streamer");
    expect(
      page().getByRole("link", { name: "sign in to Twitch" }),
    ).toHaveAttribute("href", "/settings");

    await signedIn("streamer_tv");

    expect(page().getByText("@streamer_tv")).toBeVisible();
  });

  it("has only Twitch's row without TikTok, and no key hint", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["twitch"]);
    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, settingsReply());

    expect(page().queryByPlaceholderText("@username")).not.toBeInTheDocument();
    expect(page().queryByText(/Euler Stream API key/)).not.toBeInTheDocument();

    // Twitch's channel is the account
    await user.click(page().getByRole("button", { name: "Connect" }));
    expect(sent(APP_EVENTS.CONNECT)).toEqual([{ username: "@streamer" }]);
  });

  it("says how each platform is doing, with Try again for one that's down", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);
    await signedIn("streamer_tv");

    await live({ tiktok: "connected" });
    const twitch = page().getByText("@streamer_tv").closest("li")!;
    const tiktok = page().getByPlaceholderText("@username").closest("li")!;

    expect(within(tiktok).getByText("Connected")).toBeVisible();
    expect(within(twitch).getByText("Not connected")).toBeVisible();

    await user.click(within(twitch).getByRole("button", { name: "Try again" }));
    expect(sent(APP_EVENTS.CONNECT)).toEqual([{ username: "@streamer" }]);

    await live({ tiktok: "reconnecting", twitch: "connecting" });
    expect(within(tiktok).getByText("Reconnecting…")).toBeVisible();
    expect(within(twitch).getByText("Connecting…")).toBeVisible();
    expect(
      page().queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("shows no states with one platform, as before", async () => {
    await renderApp();
    await usingPlatforms(["tiktok"]);

    await live({ tiktok: "connected" });

    expect(page().queryByText("Connected")).not.toBeInTheDocument();
  });

  it.each([
    [["tiktok"], ["Likes", "Total views", "Shares", "Gifts", "Coins"], []],
    [["twitch"], [], ["Likes", "Total views", "Shares", "Gifts", "Coins"]],
    [
      ["tiktok", "twitch"],
      ["Likes", "Total views", "Shares", "Gifts", "Coins"],
      [],
    ],
  ] as [Platform[], string[], string[]][])(
    "shows the stats %j has",
    async (platforms, shown, hidden) => {
      await renderApp();
      await usingPlatforms(platforms);
      await live({});

      expect(stat("New followers")).toBeInTheDocument();
      for (const label of shown) expect(stat(label)).toBeInTheDocument();
      for (const label of hidden) expect(stat(label)).not.toBeInTheDocument();
      // Top gifters come with gifts
      expect(page().queryByText("Top gifters") !== null).toBe(
        shown.includes("Gifts"),
      );
    },
  );

  it("marks each event with its platform when the profile uses several", async () => {
    await renderApp();
    const activity = () =>
      within(page().getByRole("list", { name: "Activity" }));
    await send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveSession({
        activity: [
          {
            id: 2,
            type: "follow",
            user: {
              handle: "kai",
              name: "Kai",
              picture: "",
              platform: "twitch",
            },
          },
          {
            id: 1,
            type: "follow",
            user: { handle: "yui", name: "Yui", picture: "" },
          },
        ],
      }),
    });

    expect(activity().queryByRole("img", { name: "Twitch" })).toBeNull();

    await usingPlatforms(["tiktok", "twitch"]);

    expect(activity().getByRole("img", { name: "Twitch" })).toBeVisible();
    expect(activity().getByRole("img", { name: "TikTok" })).toBeVisible();
  });

  it("renders Twitch's events with their numbers and texts", async () => {
    await renderApp();
    const user = (name: string) => ({
      handle: name,
      name,
      picture: "",
      platform: "twitch" as const,
    });
    await send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveSession({
        activity: [
          { id: 6, type: "sub", user: user("Ann"), months: 1, text: "" },
          { id: 5, type: "sub", user: user("Bo"), months: 7, text: "hi" },
          { id: 4, type: "giftsub", user: user("Cy"), count: 5 },
          { id: 3, type: "cheer", user: user("Di"), bits: 100, text: "gg" },
          { id: 2, type: "raid", user: user("Ed"), viewers: 42 },
          {
            id: 1,
            type: "redeem",
            user: user("Flo"),
            reward: "Hydrate",
            text: "now!",
          },
        ],
      }),
    });

    const items = within(
      page().getByRole("list", { name: "Activity" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "AAnn subscribed",
      "BBo subscribed for 7 monthshi",
      "CCy gifted 5 subs",
      "DDi cheered 100 Bitsgg",
      "EEd raided with 42 viewers",
      "FFlo redeemed Hydratenow!",
    ]);
  });

  it("offers only the feed kinds the profile's platforms send", async () => {
    const { user } = await renderApp();
    const dialog = () => within(screen.getByRole("dialog"));
    const open = async () => {
      await user.click(page().getByRole("button", { name: "Feed settings" }));
      const names = dialog()
        .getAllByRole("checkbox")
        .map(
          (box) =>
            box.getAttribute("aria-label") ?? box.closest("label")?.textContent,
        );
      await user.click(dialog().getByRole("button", { name: "Cancel" }));
      return names;
    };

    expect(await open()).toEqual([
      "Chats",
      "Gifts",
      "Follows",
      "Shares",
      "New Super Fans",
      "Viewers joining",
    ]);

    await usingPlatforms(["twitch"]);

    expect(await open()).toEqual([
      "Chats",
      "Follows",
      "New subs",
      "Gifted subs",
      "Bits",
      "Raids",
      "Channel points",
    ]);
  });
});
