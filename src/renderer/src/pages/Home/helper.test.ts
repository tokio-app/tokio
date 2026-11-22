import { createAlert } from "@/common/util";
import { liveSession, topGifter } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  alertsStatus,
  chartPoints,
  joinedText,
  livePlatforms,
  liveView,
  nearestIndex,
  overlaysStatus,
  songParts,
} from "./helper";

const totals = (gifts: number, coins: number) => ({
  followers: 0,
  shares: 0,
  gifts,
  coins,
});

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
  const ana = topGifter("Ana", 20);
  const kai = topGifter("Kai", 30, { platform: "kick" });
  const numbers = {
    session: liveSession({
      totals: totals(5, 50),
      viewers: [60],
      platforms: { kick: { totals: totals(3, 30), viewers: [20] } },
    }),
    views: { current: 60, total: 900, platformViewers: { kick: 20 } },
    likes: 7,
    gifters: { data: [kai, ana], byPlatform: { kick: [kai] } },
  };

  it("adds up the LIVE's platforms on All, TikTok's likes included", () => {
    const view = liveView("all", ["tiktok", "kick"], numbers);

    expect(view).toMatchObject({
      viewers: 60,
      minutes: [60],
      gifters: [kai, ana],
    });
    expect(view.stats.map((stat) => stat.label)).toContain("home.stats.likes");
  });

  it("gives a platform its own numbers and stats", () => {
    expect(liveView("kick", ["tiktok", "kick"], numbers)).toEqual({
      viewers: 20,
      minutes: [20],
      stats: [
        { label: "home.totals.gifts", value: 3 },
        { label: "home.totals.coins", value: 30 },
      ],
      gifters: [kai],
    });
  });

  it("gives a platform with nothing yet zeros, and no gifters without coins", () => {
    expect(liveView("youtube", ["youtube", "kick"], numbers)).toEqual({
      viewers: 0,
      minutes: [],
      stats: [{ label: "home.totals.gifts", value: 0 }],
      gifters: null,
    });
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
