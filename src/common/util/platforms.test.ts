import { ALERT_TRIGGERS } from "@/common/schemas";
import { EMOTE_TRIGGER, PLATFORMS, TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  GIFT_CURRENCY,
  giftCurrencies,
  isPlatform,
  PLATFORM_TRIGGERS,
  platformOf,
  platformsOf,
  triggersFor,
} from "./platforms";

describe("platforms", () => {
  it("gives every trigger a platform, but Music change", () => {
    const orphans = ALERT_TRIGGERS.filter((t) => platformsOf(t).length === 0);
    expect(orphans).toEqual([TOKIO_EVENTS.MUSIC_CHANGE]);
  });

  it("lists only alert triggers, each once per platform", () => {
    for (const platform of PLATFORMS) {
      const row = PLATFORM_TRIGGERS[platform];
      expect(new Set(row).size).toBe(row.length);
      expect(row.every((t) => ALERT_TRIGGERS.includes(t))).toBe(true);
    }
  });

  it("keeps TikTok's triggers as they were, with Music change", () => {
    expect(triggersFor(["tiktok"])).toEqual(
      ALERT_TRIGGERS.filter(
        (t) =>
          PLATFORM_TRIGGERS.tiktok.includes(t) ||
          t === TOKIO_EVENTS.MUSIC_CHANGE,
      ),
    );
  });

  it("joins the triggers of several platforms in the triggers' order", () => {
    const all = triggersFor(["youtube", "twitch", "tiktok"]);
    expect(all).toEqual(ALERT_TRIGGERS);
    expect(triggersFor(["twitch", "tiktok"])).toEqual(
      ALERT_TRIGGERS.filter((t) => t !== TOKIO_EVENTS.SUPER_CHAT),
    );
    expect(triggersFor(["twitch"])).toEqual([
      TOKIO_EVENTS.CHAT,
      EMOTE_TRIGGER,
      TOKIO_EVENTS.FOLLOW,
      TOKIO_EVENTS.SUBSCRIBE,
      TOKIO_EVENTS.GIFT_SUB,
      TOKIO_EVENTS.CHEER,
      TOKIO_EVENTS.RAID,
      TOKIO_EVENTS.REDEEM,
      TOKIO_EVENTS.MUSIC_CHANGE,
    ]);
    expect(triggersFor(["youtube"])).toEqual([
      TOKIO_EVENTS.CHAT,
      EMOTE_TRIGGER,
      TOKIO_EVENTS.GIFT,
      TOKIO_EVENTS.SUBSCRIBE,
      TOKIO_EVENTS.GIFT_SUB,
      TOKIO_EVENTS.SUPER_CHAT,
      TOKIO_EVENTS.MUSIC_CHANGE,
    ]);
    expect(triggersFor(["kick"])).toEqual([
      TOKIO_EVENTS.CHAT,
      EMOTE_TRIGGER,
      TOKIO_EVENTS.GIFT,
      TOKIO_EVENTS.SUBSCRIBE,
      TOKIO_EVENTS.GIFT_SUB,
      TOKIO_EVENTS.RAID,
      TOKIO_EVENTS.REDEEM,
      TOKIO_EVENTS.MUSIC_CHANGE,
    ]);
  });

  it("prices TikTok's gifts in coins and Kick's in Kicks, each apart", () => {
    expect(GIFT_CURRENCY).toEqual({
      tiktok: "coins",
      twitch: null,
      youtube: null,
      kick: "kicks",
    });
    expect(giftCurrencies(["kick", "youtube", "tiktok"])).toEqual([
      "coins",
      "kicks",
    ]);
    expect(giftCurrencies(["twitch", "youtube"])).toEqual([]);
  });

  it("reads a viewer without a platform as TikTok's", () => {
    expect(platformOf({})).toBe("tiktok");
    expect(platformOf(null)).toBe("tiktok");
    expect(platformOf({ platform: "twitch" })).toBe("twitch");
  });

  it("knows its platforms only", () => {
    expect(isPlatform("twitch")).toBe(true);
    expect(isPlatform("myspace")).toBe(false);
    expect(isPlatform(undefined)).toBe(false);
  });
});
