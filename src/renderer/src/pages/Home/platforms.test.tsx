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
const row = (name: string) =>
  within(page().getByRole("list", { name: "Platforms" }))
    .getByText(name, { selector: "span" })
    .closest("li")!;
const stat = (label: string) => page().queryByText(label);

const usingPlatforms = (
  platforms: Platform[],
  channels: Partial<Record<Platform, string>> = {},
) =>
  send(
    APP_EVENTS_RESPONSE.GET_PROFILE,
    profileReply((p) => {
      p.platforms = platforms;
      p.connector.username = "@streamer";
      p.channels = channels;
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
  it("adds a platform from its menu and removes it again", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok"]);
    // The only platform can't go
    expect(
      page().queryByRole("button", { name: "Remove TikTok" }),
    ).not.toBeInTheDocument();

    const add = page().getByRole("button", { name: "Add a platform" });
    await user.click(add);
    const menu = within(page().getByRole("menu", { name: "Add a platform" }));
    expect(menu.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      " Twitch",
      " YouTube",
      " Kick",
    ]);
    await user.click(menu.getByRole("menuitem", { name: "Kick" }));

    expect(sent(APP_EVENTS.SET_PLATFORMS)).toEqual([
      { platforms: ["tiktok", "kick"] },
    ]);
    // The new row's field takes the focus
    expect(
      page().getByPlaceholderText("Channel or kick.com link"),
    ).toHaveFocus();

    await user.click(page().getByRole("button", { name: "Remove Kick" }));
    expect(sent(APP_EVENTS.SET_PLATFORMS).at(-1)).toEqual({
      platforms: ["tiktok"],
    });
    expect(add).toHaveFocus();
  });

  it("shows what main holds after a change", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok"]);

    await user.click(page().getByRole("button", { name: "Add a platform" }));
    await user.click(page().getByRole("menuitem", { name: "Twitch" }));
    await send(APP_EVENTS_RESPONSE.SET_PLATFORMS, {
      success: false,
      platforms: ["tiktok"],
    });

    expect(page().queryByText("Twitch", { selector: "span" })).toBeNull();
  });

  it("keeps a platform that's on, and adds others while live", async () => {
    await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);

    await live({ tiktok: "connected" });

    expect(
      page().getByRole("button", { name: "Remove TikTok" }),
    ).toBeDisabled();
    expect(page().getByRole("button", { name: "Remove Twitch" })).toBeEnabled();
    expect(
      page().getByRole("button", { name: "Add a platform" }),
    ).toBeEnabled();
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

  it("connects Twitch alone only once signed in, with no key hint", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["twitch"]);
    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, settingsReply());

    expect(page().queryByPlaceholderText("@username")).not.toBeInTheDocument();
    expect(page().queryByText(/Euler Stream API key/)).not.toBeInTheDocument();

    const connect = page().getByRole("button", { name: "Connect" });
    await user.click(connect);
    expect(sent(APP_EVENTS.CONNECT)).toEqual([]);

    // Twitch's channel is the account
    await signedIn("streamer_tv");
    await user.click(connect);
    expect(sent(APP_EVENTS.CONNECT)).toEqual([
      { username: "@streamer", channels: {} },
    ]);
  });

  it("gives YouTube a row with the saved channel, and connects with it", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "youtube"], { youtube: "@saved" });
    const channel = page().getByPlaceholderText("@channel or LIVE link");
    expect(channel).toHaveValue("@saved");

    await user.clear(channel);
    await user.type(channel, "@typed");
    await user.click(page().getByRole("button", { name: "Connect all" }));

    expect(sent(APP_EVENTS.CONNECT)).toEqual([
      { username: "@streamer", channels: { youtube: "@typed" } },
    ]);
  });

  it("connects the ready ones and says what each other one needs", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "youtube", "kick"], { kick: "westcol" });

    await user.click(page().getByRole("button", { name: "Connect all" }));

    expect(sent(APP_EVENTS.CONNECT)).toEqual([
      {
        username: "@streamer",
        channels: { kick: "westcol" },
        platforms: ["tiktok", "kick"],
      },
    ]);
    expect(within(row("YouTube")).getByRole("alert")).toHaveTextContent(
      "Type the channel first.",
    );

    // It goes once the channel is typed
    await user.type(
      page().getByPlaceholderText("@channel or LIVE link"),
      "@tokio",
    );
    expect(within(row("YouTube")).queryByRole("alert")).toBeNull();
  });

  it("doesn't connect YouTube without a channel, and says so", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["youtube"]);

    await user.click(page().getByRole("button", { name: "Connect" }));

    expect(sent(APP_EVENTS.CONNECT)).toEqual([]);
    expect(page().getByRole("alert")).toHaveTextContent(
      "Type the channel first.",
    );
    expect(page().getByPlaceholderText("@channel or LIVE link")).toHaveFocus();
  });

  it("says how each platform is doing, and connects or disconnects one", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);
    await signedIn("streamer_tv");

    await live({ tiktok: "connected" });

    expect(within(row("TikTok")).getByText("Connected")).toBeVisible();
    expect(within(row("Twitch")).getByText("Not connected")).toBeVisible();

    await user.click(page().getByRole("button", { name: "Connect Twitch" }));
    expect(sent(APP_EVENTS.CONNECT)).toEqual([
      { username: "@streamer", channels: {}, platforms: ["twitch"] },
    ]);
    await user.click(page().getByRole("button", { name: "Disconnect TikTok" }));
    expect(sent(APP_EVENTS.DISCONNECT)).toEqual([{ platform: "tiktok" }]);

    await live({ tiktok: "reconnecting", twitch: "connecting" });
    expect(within(row("TikTok")).getByText("Reconnecting…")).toBeVisible();
    expect(within(row("Twitch")).getByText("Connecting…")).toBeVisible();

    await user.click(page().getByRole("button", { name: "Disconnect all" }));
    expect(sent(APP_EVENTS.DISCONNECT)).toHaveLength(2);
    expect(sent(APP_EVENTS.DISCONNECT).at(-1)).toBeUndefined();
  });

  it("shows its state under a platform that's alone too", async () => {
    await renderApp();
    await usingPlatforms(["tiktok"]);

    await live({ tiktok: "connected" });

    expect(within(row("TikTok")).getByText("Connected")).toBeVisible();
    expect(page().getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  it.each([
    [["tiktok"], ["Likes", "Total views", "Shares", "Gifts", "Coins"], []],
    [["twitch"], [], ["Likes", "Total views", "Shares", "Gifts", "Coins"]],
    [
      ["tiktok", "twitch"],
      ["Likes", "Total views", "Shares", "Gifts", "Coins"],
      [],
    ],
    [
      ["youtube"],
      ["Gifts"],
      ["New followers", "Likes", "Total views", "Shares", "Coins"],
    ],
    [
      ["kick"],
      ["Gifts", "Coins"],
      ["New followers", "Likes", "Total views", "Shares"],
    ],
  ] as [Platform[], string[], string[]][])(
    "shows the stats %j has",
    async (platforms, shown, hidden) => {
      await renderApp();
      await usingPlatforms(platforms);
      await live({});

      expect(stat("New followers") !== null).toBe(
        !hidden.includes("New followers"),
      );
      for (const label of shown) expect(stat(label)).toBeInTheDocument();
      for (const label of hidden) expect(stat(label)).not.toBeInTheDocument();
      // Top gifters come with coins
      expect(page().queryByText("Top gifters") !== null).toBe(
        shown.includes("Coins"),
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

  it("renders YouTube's gifts, Super Chats and Super Stickers", async () => {
    await renderApp();
    const user = (name: string) => ({
      handle: name,
      name,
      picture: "",
      platform: "youtube" as const,
    });
    await send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveSession({
        activity: [
          {
            id: 3,
            type: "gift",
            user: user("Cy"),
            gift: { name: "Heart", image: "", count: 1, coins: 0 },
          },
          {
            id: 2,
            type: "superchat",
            user: user("Ann"),
            amount: "€5.00",
            text: "",
            sticker: "https://example.com/sticker.png",
          },
          {
            id: 1,
            type: "superchat",
            user: user("Bo"),
            amount: "$4.99",
            text: "hello",
            sticker: "",
          },
        ],
      }),
    });

    const items = within(
      page().getByRole("list", { name: "Activity" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      // No "0 coins" for a gift without a price
      "CCy sent Heart ",
      "AAnn sent a €5.00 Super Sticker ",
      "BBo sent a $4.99 Super Chathello",
    ]);
    expect(items[1].querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/sticker.png",
    );
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

    await usingPlatforms(["youtube"]);

    expect(await open()).toEqual([
      "Chats",
      "Gifts",
      "New subs",
      "Gifted subs",
      "Super Chats",
    ]);
  });
});
