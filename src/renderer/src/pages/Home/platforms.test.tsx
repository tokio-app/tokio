import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Platform,
  PlatformStatus,
} from "@/common/types";
import {
  gifter,
  liveSession,
  liveTotals,
  profileReply,
  settingsReply,
} from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const page = () => within(screen.getByRole("main"));
// A platform's tab, whose name can carry its viewers
const tab = (name: string) =>
  page().getByRole("tab", { name: new RegExp(`^${name}`) });
const tabNames = () =>
  page()
    .getAllByRole("tab")
    .map((t) => t.textContent);
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
    stats: { views: 10, viewers: 2, likes: 3, platformViewers: {} },
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

  it("gives each platform a tab, the first one open, and All only while LIVE on two", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "kick"], { kick: "westcol" });

    expect(tabNames()).toEqual(["TikTok", "Kick"]);
    expect(tab("TikTok")).toHaveAttribute("aria-selected", "true");
    expect(page().getByPlaceholderText("@username")).toBeVisible();

    await user.click(tab("Kick"));
    expect(page().getByPlaceholderText("Channel or kick.com link")).toHaveValue(
      "westcol",
    );
    expect(page().queryByPlaceholderText("@username")).toBeNull();

    // Alone in the LIVE, nothing to add up
    await live({ tiktok: "connected" });
    expect(tabNames()).toEqual(["TikTok0", "Kick"]);
    await live({ tiktok: "connected", kick: "connected" });
    expect(tabNames()).toEqual(["TikTok0", "Kick0", "All2"]);
  });

  it("keeps a platform that's on, and adds others while live", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);

    await live({ tiktok: "connected" });

    // On, it can't be removed: its tab has no ×
    expect(
      page().queryByRole("button", { name: "Remove TikTok" }),
    ).not.toBeInTheDocument();
    await user.click(tab("Twitch"));
    expect(page().getByRole("button", { name: "Remove Twitch" })).toBeEnabled();
    expect(
      page().getByRole("button", { name: "Add a platform" }),
    ).toBeEnabled();
  });

  it("gives Twitch a tab with the account, or a link to sign in", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "twitch"]);

    expect(page().getByPlaceholderText("@username")).toHaveValue("@streamer");
    await user.click(tab("Twitch"));
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

  it("gives YouTube a tab with the saved channel, and connects with it", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "youtube"], { youtube: "@saved" });
    await user.click(tab("YouTube"));
    const channel = page().getByPlaceholderText("@channel or LIVE link");
    expect(channel).toHaveValue("@saved");

    await user.clear(channel);
    await user.type(channel, "@typed");
    await user.click(page().getByRole("button", { name: "Connect all" }));

    expect(sent(APP_EVENTS.CONNECT)).toEqual([
      { username: "@streamer", channels: { youtube: "@typed" } },
    ]);
  });

  it("takes the names saved without connecting, but not into a field being typed in", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["tiktok", "youtube"]);

    await send(APP_EVENTS_RESPONSE.SET_CHANNELS, {
      success: true,
      username: "@saved",
      channels: { youtube: "@savedyt" },
    });
    expect(page().getByPlaceholderText("@username")).toHaveValue("@saved");

    await user.click(tab("YouTube"));
    const channel = page().getByPlaceholderText("@channel or LIVE link");
    expect(channel).toHaveValue("@savedyt");

    await user.clear(channel);
    await user.type(channel, "@typed");
    await send(APP_EVENTS_RESPONSE.SET_CHANNELS, {
      success: true,
      username: "@other",
      channels: { youtube: "@pushed" },
    });
    expect(channel).toHaveValue("@typed");
    await user.click(tab("TikTok"));
    expect(page().getByPlaceholderText("@username")).toHaveValue("@other");
  });

  it("connects the ready ones and opens the first that needs something", async () => {
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
    expect(tab("YouTube")).toHaveAttribute("aria-selected", "true");
    expect(page().getByRole("alert")).toHaveTextContent(
      "Type the channel first.",
    );
    const channel = page().getByPlaceholderText("@channel or LIVE link");
    expect(channel).toHaveFocus();

    // It goes once the channel is typed
    await user.type(channel, "@tokio");
    expect(page().queryByRole("alert")).toBeNull();
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

    expect(page().getByText("Connected")).toBeVisible();
    await user.click(page().getByRole("button", { name: "Disconnect TikTok" }));
    expect(sent(APP_EVENTS.DISCONNECT)).toEqual([{ platform: "tiktok" }]);

    await user.click(tab("Twitch"));
    expect(page().getByText("Not connected")).toBeVisible();
    await user.click(page().getByRole("button", { name: "Connect Twitch" }));
    expect(sent(APP_EVENTS.CONNECT)).toEqual([
      { username: "@streamer", channels: {}, platforms: ["twitch"] },
    ]);

    await live({ tiktok: "reconnecting", twitch: "connecting" });
    expect(page().getByText("Connecting…")).toBeVisible();
    await user.click(tab("TikTok"));
    expect(page().getByText("Reconnecting…")).toBeVisible();

    await user.click(page().getByRole("button", { name: "Disconnect all" }));
    expect(sent(APP_EVENTS.DISCONNECT)).toHaveLength(2);
    expect(sent(APP_EVENTS.DISCONNECT).at(-1)).toBeUndefined();
  });

  it("gives a platform that's alone its tab and state too", async () => {
    await renderApp();
    await usingPlatforms(["tiktok"]);

    await live({ tiktok: "connected" });

    expect(tabNames()).toEqual(["TikTok0"]);
    expect(page().getByText("Connected")).toBeVisible();
    expect(page().getByRole("button", { name: "Disconnect" })).toBeVisible();
    // Its own Disconnect is all there is
    expect(
      page().queryByRole("button", { name: "Disconnect all" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      ["tiktok"],
      ["Likes", "Total views", "Shares", "Gifts", "Coins"],
      ["Gifted subs", "Kicks", "Bits", "Super Chats"],
    ],
    [
      ["twitch"],
      ["Gifted subs", "Bits"],
      ["Likes", "Total views", "Shares", "Gifts", "Coins", "Super Chats"],
    ],
    [
      ["youtube"],
      ["Gifts", "Gifted subs", "Super Chats"],
      ["New followers", "Likes", "Total views", "Shares", "Coins", "Bits"],
    ],
    [
      ["kick"],
      ["Gifted subs", "Kicks"],
      [
        "New followers",
        "Likes",
        "Total views",
        "Shares",
        "Gifts",
        "Coins",
        "Bits",
      ],
    ],
  ] as [Platform[], string[], string[]][])(
    "shows the stats %j has",
    async (platforms, shown, hidden) => {
      await renderApp();
      await usingPlatforms(platforms);
      await live(Object.fromEntries(platforms.map((p) => [p, "connected"])));
      // Alone, nothing to add up
      expect(page().getAllByRole("tab")).toHaveLength(1);

      expect(stat("New followers") !== null).toBe(
        !hidden.includes("New followers"),
      );
      for (const label of shown) expect(stat(label)).toBeInTheDocument();
      for (const label of hidden) expect(stat(label)).not.toBeInTheDocument();
      // Every platform's tab tops who sent the most in its currency, and
      // where subs are gifted, who gifted the most apart
      const tops: Record<Platform, string[]> = {
        tiktok: ["Top gifters"],
        twitch: ["Top Bits", "Top gifted subs"],
        youtube: ["Top Super Chats", "Top gifted subs"],
        kick: ["Top Kicks", "Top gifted subs"],
      };
      for (const title of tops[platforms[0]]) {
        expect(page().getByRole("heading", { name: title })).toBeVisible();
      }
    },
  );

  it("shows each platform's numbers in its tab while it's in the LIVE, then All's", async () => {
    const { user } = await renderApp();
    // Twitch isn't connected and has no numbers
    await usingPlatforms(["tiktok", "twitch", "kick"]);
    await send(APP_EVENTS_RESPONSE.CONNECTED, {
      success: true,
      live: true,
      platforms: { tiktok: "connected", kick: "reconnecting" },
      stats: {
        views: 900,
        viewers: 60,
        likes: 7,
        platformViewers: { tiktok: 40, kick: 20 },
      },
    });
    await send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveSession({
        startedAt: Date.now(),
        totals: liveTotals({
          followers: 3,
          shares: 1,
          gifts: 5,
          coins: 20,
          kicks: 30,
        }),
        viewers: [60],
        platforms: {
          tiktok: {
            totals: liveTotals({
              followers: 3,
              shares: 1,
              gifts: 2,
              coins: 20,
            }),
            viewers: [40],
          },
          kick: {
            totals: liveTotals({ gifts: 3, kicks: 30 }),
            viewers: [20],
          },
        },
      }),
    });
    const ana = gifter("Ana", 20);
    const kai = gifter("Kai", 30, 1, { platform: "kick" });
    await send(APP_EVENTS_RESPONSE.LIVE_GIFTERS, {
      byPlatform: { tiktok: [ana], kick: [kai] },
      subsByPlatform: {},
    });
    const value = (label: string) =>
      page().getByText(label, { selector: "span" }).previousElementSibling;
    const top = (name: string) =>
      within(page().getByRole("list", { name }))
        .getAllByRole("listitem")
        .map((item) => item.textContent);

    expect(tabNames()).toEqual(["TikTok40", "Twitch", "Kick20", "All60"]);
    // The first platform's own numbers
    expect(tab("TikTok")).toHaveAttribute("aria-selected", "true");
    expect(value("Viewers")).toHaveTextContent("40");
    expect(value("Gifts")).toHaveTextContent("2");
    expect(value("Likes")).toHaveTextContent("7");
    expect(value("Coins")).toHaveTextContent("20");
    expect(stat("Kicks")).toBeNull();
    expect(top("Top gifters")).toEqual(["1AAna20 coins"]);
    // TikTok gifts no subs
    expect(page().queryByText("Top gifted subs")).toBeNull();

    // Not in the LIVE: its connection alone
    await user.click(tab("Twitch"));
    expect(stat("Viewers")).toBeNull();

    await user.click(tab("Kick"));
    expect(value("Viewers")).toHaveTextContent("20");
    // Kick's gifts cost Kicks, never coins
    expect(value("Kicks")).toHaveTextContent("30");
    expect(stat("Coins")).toBeNull();
    // Kick sends no follows, likes or shares
    expect(stat("New followers")).toBeNull();
    expect(stat("Likes")).toBeNull();
    // Kicks are Kick's money, not gifts, with gifted subs topped apart
    expect(top("Top Kicks")).toEqual(["1KKai30 Kicks"]);
    expect(page().getByText("No gifted subs yet")).toBeVisible();

    // Each currency on its own, and no top gifters, which would mix them
    await user.click(tab("All"));
    expect(value("Viewers")).toHaveTextContent("60");
    expect(value("Gifts")).toHaveTextContent("5");
    expect(value("New followers")).toHaveTextContent("3");
    expect(value("Coins")).toHaveTextContent("20");
    expect(value("Kicks")).toHaveTextContent("30");
    expect(page().queryByText("Top gifters")).toBeNull();
    expect(page().queryByText("Top Kicks")).toBeNull();
  });

  it("shows Twitch's Bits and YouTube's Super Chats in dollars, a dash until the rates load", async () => {
    const { user } = await renderApp();
    await usingPlatforms(["twitch", "youtube"]);
    await live({ twitch: "connected", youtube: "connected" });
    const session = (usd: number | null) =>
      send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
        data: liveSession({
          startedAt: Date.now(),
          totals: liveTotals({ bits: 1500, superChats: 3 }),
          usd,
          platforms: {
            twitch: { totals: liveTotals({ bits: 1500 }), viewers: [] },
            youtube: { totals: liveTotals({ superChats: 3 }), viewers: [] },
          },
        }),
      });
    const value = (label: string) =>
      page().getByText(label, { selector: "span" }).previousElementSibling;

    await session(null);
    await user.click(tab("All"));
    expect(value("Bits")).toHaveTextContent("1.5K");
    expect(value("Super Chats")).toHaveTextContent("—");
    expect(value("Super Chats")).toHaveAttribute(
      "title",
      "Exchange rates haven't loaded yet",
    );

    await session(1234.5);
    expect(value("Super Chats")).toHaveTextContent("$1.23K");
    expect(value("Super Chats")).toHaveAttribute("title", "$1,234.50");

    // Each tab's top in its currency, and who gifted the most subs apart
    const di = gifter("Di", 1500, 0, { platform: "twitch", giftSubs: 2 });
    const bo = gifter("Bo", 0, 0, { platform: "twitch", giftSubs: 5 });
    await send(APP_EVENTS_RESPONSE.LIVE_GIFTERS, {
      byPlatform: {
        twitch: [di, bo],
        youtube: [gifter("Yui", 57.4, 0, { platform: "youtube" })],
      },
      subsByPlatform: { twitch: [bo, di] },
    });
    const top = (name: string) =>
      within(page().getByRole("list", { name }))
        .getAllByRole("listitem")
        .map((item) => item.textContent);

    await user.click(tab("Twitch"));
    expect(value("Gifted subs")).toHaveTextContent("0");
    expect(top("Top Bits")).toEqual(["1DDi1,500 Bits"]);
    expect(top("Top gifted subs")).toEqual([
      "1BBo5 gifted subs",
      "2DDi2 gifted subs",
    ]);

    await user.click(tab("YouTube"));
    expect(value("Super Chats")).toHaveTextContent("$1.23K");
    expect(stat("Bits")).toBeNull();
    expect(top("Top Super Chats")).toEqual(["1YYui$57.40"]);
    expect(page().getByText("No gifted subs yet")).toBeVisible();

    // None on All, which would rank one currency against another
    await user.click(tab("All"));
    expect(page().queryByText("Top Bits")).toBeNull();
    expect(page().queryByText("Top gifted subs")).toBeNull();
  });

  it("adds up only the profile's platforms on All", async () => {
    await renderApp();
    await usingPlatforms(["tiktok"]);
    await live({ tiktok: "connected" });
    // Kick left the profile mid-LIVE, its numbers still in the session
    await send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveSession({
        startedAt: Date.now(),
        platforms: {
          tiktok: { totals: liveTotals(), viewers: [] },
          kick: { totals: liveTotals({ kicks: 5 }), viewers: [] },
        },
      }),
    });

    expect(tabNames()).toEqual(["TikTok0"]);
    expect(stat("Kicks")).toBeNull();
  });

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

    await usingPlatforms(["kick"]);

    // Kicks, never gifts
    expect(await open()).toEqual([
      "Chats",
      "New subs",
      "Gifted subs",
      "Raids",
      "Channel points",
      "Kicks",
    ]);
  });
});
