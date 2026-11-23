import { createAlert } from "@/common/util";
import { gifter, liveSession, liveTotals } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  alertsStatus,
  chartPoints,
  joinedText,
  livePlatforms,
  liveView,
  nearestIndex,
  overlaysStatus,
  sentLabel,
  songParts,
} from "./helper";

const totals = (gifts: number, coins: number) => liveTotals({ gifts, coins });

describe("livePlatforms", () => {
  it("lists the platforms up now or with numbers, in Home's order", () => {
    const session = liveSession({
      platforms: { youtube: { totals: totals(1, 0), viewers: [] } },
    });

    expect(
      livePlatforms(
        { kick: "reconnecting", tiktok: "connected", twitch: "connecting" },
        session,
      ),
    ).toEqual(["tiktok", "youtube", "kick"]);
  });
});

describe("liveView", () => {
  const ana = gifter("Ana", 20);
  const kai = gifter("Kai", 30, 1, { platform: "kick" });
  const numbers = {
    session: liveSession({
      totals: liveTotals({ gifts: 5, coins: 20, kicks: 30 }),
      viewers: [60],
      platforms: {
        tiktok: {
          totals: liveTotals({ gifts: 2, coins: 20 }),
          viewers: [40],
        },
        kick: { totals: liveTotals({ gifts: 3, kicks: 30 }), viewers: [20] },
      },
    }),
    views: { current: 60, total: 900, platformViewers: { kick: 20 } },
    likes: 7,
    gifters: { byPlatform: { tiktok: [ana], kick: [kai] } },
  };
  const labels = (view: ReturnType<typeof liveView>) =>
    view.stats.map((stat) => stat.label);

  it("adds up the LIVE's platforms on All, with a tile per currency and no top gifters", () => {
    const view = liveView("all", ["tiktok", "kick"], numbers);

    expect(view).toMatchObject({ viewers: 60, minutes: [60], gifters: null });
    expect(view.stats).toEqual([
      { label: "home.stats.likes", value: 7 },
      { label: "home.stats.totalViews", value: 900 },
      { label: "home.totals.followers", value: 0 },
      { label: "home.totals.shares", value: 0 },
      { label: "home.totals.gifts", value: 5 },
      // Kick sends gifted subs
      { label: "home.totals.giftSubs", value: 0 },
      { label: "home.totals.coins", value: 20 },
      { label: "home.totals.kicks", value: 30 },
    ]);
  });

  it("gives a platform its own numbers, stats and top gifters in its currency", () => {
    expect(liveView("kick", ["tiktok", "kick"], numbers)).toEqual({
      viewers: 20,
      minutes: [20],
      stats: [
        { label: "home.totals.gifts", value: 3 },
        { label: "home.totals.giftSubs", value: 0 },
        { label: "home.totals.kicks", value: 30 },
      ],
      gifters: { currency: "kicks", list: [kai] },
    });
    expect(liveView("tiktok", ["tiktok", "kick"], numbers).gifters).toEqual({
      currency: "coins",
      list: [ana],
    });
  });

  it("gives a platform with nothing yet zeros, and its gifters in dollars", () => {
    expect(liveView("youtube", ["youtube", "kick"], numbers)).toEqual({
      viewers: 0,
      minutes: [],
      stats: [
        { label: "home.totals.gifts", value: 0 },
        { label: "home.totals.giftSubs", value: 0 },
        { label: "home.totals.superChats", value: 0, money: true },
      ],
      gifters: { currency: "usd", list: [] },
    });
  });

  it("counts Twitch's gifted subs, with its top gifters in Bits", () => {
    const yui = gifter("Yui", 500, 0, { platform: "twitch", giftSubs: 3 });
    const view = liveView("twitch", ["tiktok", "twitch"], {
      ...numbers,
      session: liveSession({
        totals: liveTotals({ bits: 500, giftSubs: 3 }),
        platforms: {
          twitch: {
            totals: liveTotals({ bits: 500, giftSubs: 3 }),
            viewers: [],
          },
        },
      }),
      gifters: { byPlatform: { twitch: [yui] } },
    });

    expect(view.stats).toEqual([
      { label: "home.totals.followers", value: 0 },
      { label: "home.totals.giftSubs", value: 3 },
      { label: "home.totals.bits", value: 500 },
    ]);
    expect(view.gifters).toEqual({ currency: "bits", list: [yui] });
  });

  it("shows Twitch's Bits and YouTube's Super Chats in dollars, null until the rates load", () => {
    const session = liveSession({
      totals: liveTotals({ bits: 250, superChats: 2 }),
      usd: null,
      platforms: {
        twitch: { totals: liveTotals({ bits: 250 }), viewers: [] },
        youtube: { totals: liveTotals({ superChats: 2 }), viewers: [] },
      },
    });
    const view = (tab: "all" | "twitch" | "youtube") =>
      liveView(tab, ["twitch", "youtube"], { ...numbers, session });

    expect(labels(view("all"))).toEqual([
      "home.totals.followers",
      "home.totals.gifts",
      "home.totals.giftSubs",
      "home.totals.bits",
      "home.totals.superChats",
    ]);
    expect(view("twitch").stats).toEqual([
      { label: "home.totals.followers", value: 0 },
      { label: "home.totals.giftSubs", value: 0 },
      { label: "home.totals.bits", value: 250 },
    ]);
    expect(view("twitch").gifters).toEqual({ currency: "bits", list: [] });
    expect(view("youtube").stats).toContainEqual({
      label: "home.totals.superChats",
      value: null,
      money: true,
    });
  });

  it("shows every tile with all four platforms, never a sum of currencies", () => {
    const view = liveView("all", ["tiktok", "twitch", "youtube", "kick"], {
      ...numbers,
      session: liveSession({
        totals: liveTotals({ coins: 1, kicks: 2, bits: 3 }),
        usd: 4.5,
      }),
    });

    expect(view.stats.slice(-4)).toEqual([
      { label: "home.totals.coins", value: 1 },
      { label: "home.totals.kicks", value: 2 },
      { label: "home.totals.bits", value: 3 },
      { label: "home.totals.superChats", value: 4.5, money: true },
    ]);
    expect(view.stats).toHaveLength(10);
  });
});

describe("sentLabel", () => {
  it("writes what a gifter sent in their currency, with their gifted subs", () => {
    const sent = (
      coins: number,
      giftSubs: number,
      currency = "bits" as const,
    ) => sentLabel({ coins, giftSubs }, currency, "en");

    expect(sent(2500, 0)).toBe("2,500 Bits");
    expect(sent(2500, 3)).toBe("2,500 Bits · 3 gifted subs");
    // Only the subs when they sent nothing else
    expect(sent(0, 1)).toBe("1 gifted sub");
    expect(sent(0, 0)).toBe("0 Bits");
    expect(sentLabel({ coins: 57.4, giftSubs: 0 }, "usd", "en")).toBe("$57.40");
  });
});

describe("chartPoints", () => {
  it("spreads the points across, from 0 on the baseline to the peak on top", () => {
    expect(chartPoints([0, 20, 40])).toEqual([
      { x: 0, y: 100 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ]);
  });

  it("puts a lone point on the right edge", () => {
    expect(chartPoints([12])).toEqual([{ x: 100, y: 0 }]);
  });

  it("keeps a LIVE with no viewers on the baseline", () => {
    expect(chartPoints([0, 0])).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
  });
});

describe("nearestIndex", () => {
  it("snaps to the nearest point", () => {
    expect(nearestIndex(0.2, 3)).toBe(0);
    expect(nearestIndex(0.3, 3)).toBe(1);
    expect(nearestIndex(0.9, 3)).toBe(2);
  });

  it("stays on the chart past its edges", () => {
    expect(nearestIndex(-0.5, 3)).toBe(0);
    expect(nearestIndex(1.5, 3)).toBe(2);
    expect(nearestIndex(0.7, 1)).toBe(0);
  });
});

describe("feature status", () => {
  it("counts one alert or overlay in the singular", () => {
    expect(alertsStatus([createAlert()], "en")).toBe("1 of 1 alert on");
    expect(overlaysStatus(1, "en")).toBe("1 overlay");
  });

  it("says when there are no overlays yet", () => {
    expect(overlaysStatus(0, "en")).toBe("No overlays yet");
  });
});

describe("songParts", () => {
  it("puts the artist after the last dash, as the providers name songs", () => {
    expect(songParts("Try - P!NK")).toEqual({ name: "Try", artist: "P!NK" });
    expect(songParts("Try - Live - P!NK")).toEqual({
      name: "Try - Live",
      artist: "P!NK",
    });
  });

  it("keeps a title without one whole", () => {
    expect(songParts("Blinding Lights")).toEqual({
      name: "Blinding Lights",
      artist: "",
    });
  });
});

describe("joinedText", () => {
  const user = (name: string) => ({ handle: name, name, picture: "" });

  it("puts the verb in the number of viewers who joined", () => {
    expect(joinedText([user("kai")], 1, "es-419")).toBe("kai se unió");
    expect(joinedText([user("kai"), user("yui")], 2, "es-419")).toBe(
      "kai y yui se unieron",
    );
  });
});
