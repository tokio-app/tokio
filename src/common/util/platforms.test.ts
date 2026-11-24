import { ALERT_TRIGGERS } from "@/common/schemas";
import { EMOTE_TRIGGER, PLATFORMS, TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  GIFT_CURRENCY,
  giftCurrencies,
  idPlatform,
  isPlatform,
  PLATFORM_TRIGGERS,
  platformOf,
  platformsOf,
  rowPlatforms,
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
    const all = triggersFor(["youtube", "kick", "twitch", "tiktok"]);
    expect(all).toEqual(ALERT_TRIGGERS);
    expect(triggersFor(["twitch", "tiktok"])).toEqual(
      ALERT_TRIGGERS.filter(
        (t) => t !== TOKIO_EVENTS.SUPER_CHAT && t !== TOKIO_EVENTS.KICKS,
      ),
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
    // Kicks, never gifts
    expect(triggersFor(["kick"])).toEqual([
      TOKIO_EVENTS.CHAT,
      EMOTE_TRIGGER,
      TOKIO_EVENTS.SUBSCRIBE,
      TOKIO_EVENTS.GIFT_SUB,
      TOKIO_EVENTS.RAID,
      TOKIO_EVENTS.REDEEM,
      TOKIO_EVENTS.KICKS,
      TOKIO_EVENTS.MUSIC_CHANGE,
    ]);
  });

  it("prices only TikTok's gifts, in coins: Kick's Kicks aren't gifts", () => {
    expect(GIFT_CURRENCY).toEqual({
      tiktok: "coins",
      twitch: null,
      youtube: null,
      kick: null,
    });
    expect(giftCurrencies(["kick", "youtube", "tiktok"])).toEqual(["coins"]);
    expect(giftCurrencies(["kick"])).toEqual([]);
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

describe("idPlatform", () => {
  it("reads an id's platform from its prefix, a bare one as TikTok's", () => {
    expect(idPlatform("twitch:25")).toBe("twitch");
    expect(idPlatform("kick:")).toBe("kick");
    expect(idPlatform("youtube:@mia")).toBe("youtube");
    expect(idPlatform("7123")).toBe("tiktok");
    expect(idPlatform("")).toBe("tiktok");
    expect(idPlatform("rumble:1")).toBe("tiktok");
  });
});

describe("rowPlatforms", () => {
  it("covers a row's own platform, else the profile's that send its event", () => {
    const row = (type: (typeof ALERT_TRIGGERS)[number], platform?: "kick") => ({
      type,
      ...(platform && { platform }),
    });
    expect(rowPlatforms(row(EMOTE_TRIGGER, "kick"), PLATFORMS)).toEqual([
      "kick",
    ]);
    expect(rowPlatforms(row(EMOTE_TRIGGER), ["twitch", "kick"])).toEqual([
      "twitch",
      "kick",
    ]);
    // Twitch sends no gifts
    expect(rowPlatforms(row(TOKIO_EVENTS.GIFT), ["tiktok", "twitch"])).toEqual([
      "tiktok",
    ]);
    expect(rowPlatforms(row(TOKIO_EVENTS.MUSIC_CHANGE), PLATFORMS)).toEqual([]);
  });
});
