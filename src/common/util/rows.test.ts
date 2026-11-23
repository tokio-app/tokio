import { AlertTrigger, Platform, TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import { ALERT_MESSAGE_VARIABLES } from "./alerts";
import { roleName, rowRoles, rowVariables } from "./rows";

describe("rows on their platforms", () => {
  const ALL = ["tiktok", "twitch", "youtube", "kick"] as const;
  const gift = TOKIO_EVENTS.GIFT;
  const sub = TOKIO_EVENTS.SUBSCRIBE;
  const vars = (
    type: AlertTrigger,
    platform: Platform | undefined,
    profile: readonly Platform[] = ALL,
  ) =>
    rowVariables(
      ALERT_MESSAGE_VARIABLES[type],
      { type, ...(platform && { platform }) },
      profile,
    );

  it("leaves out the variables none of a row's platforms fill", () => {
    expect(vars(gift, "tiktok")).toEqual([
      "username",
      "handle",
      "gift",
      "count",
    ]);
    // Kick's and YouTube's gifts come one at a time
    expect(vars(gift, "kick")).toEqual(["username", "handle", "gift"]);
    expect(vars(gift, undefined, ["youtube", "kick"])).toEqual([
      "username",
      "handle",
      "gift",
    ]);
    // Any platform: what any of the profile's fills
    expect(vars(gift, undefined)).toEqual(ALERT_MESSAGE_VARIABLES[gift]);
    // Kick's subs carry no message
    expect(vars(sub, "kick")).toEqual(["username", "handle", "count"]);
    expect(vars(sub, "twitch")).toEqual(ALERT_MESSAGE_VARIABLES[sub]);
    // No platform sends Music change
    expect(vars(TOKIO_EVENTS.MUSIC_CHANGE, undefined)).toEqual(["song"]);
  });

  it("offers the roles a row's platforms say", () => {
    const chat = (
      platform?: Platform,
    ): { type: AlertTrigger; platform?: Platform } => ({
      type: TOKIO_EVENTS.CHAT,
      ...(platform && { platform }),
    });
    expect(rowRoles(chat("tiktok"), ALL)).toEqual([
      "follower",
      "moderator",
      "superfan",
    ]);
    // The others never say who follows; Twitch's and Kick's say VIPs
    expect(rowRoles(chat("twitch"), ALL)).toEqual([
      "moderator",
      "superfan",
      "vip",
    ]);
    expect(rowRoles(chat("youtube"), ALL)).toEqual(["moderator", "superfan"]);
    expect(rowRoles(chat(), ["youtube", "kick"])).toEqual([
      "moderator",
      "superfan",
      "vip",
    ]);
    expect(rowRoles(chat(), ALL)).toEqual([
      "follower",
      "moderator",
      "superfan",
      "vip",
    ]);
    // Kicks come without badges
    expect(rowRoles({ type: gift, platform: "kick" }, ALL)).toEqual([]);
    expect(rowRoles({ type: gift }, ["youtube", "kick"])).toEqual([]);
    expect(rowRoles({ type: TOKIO_EVENTS.FOLLOW }, ALL)).toEqual([]);
  });

  it("names Super Fans as the row's platforms call them", () => {
    const name = (
      platform: Platform | undefined,
      profile: readonly Platform[] = ALL,
      language = "en",
    ) =>
      roleName(
        "superfan",
        { type: TOKIO_EVENTS.CHAT, ...(platform && { platform }) },
        profile,
        language,
      );
    expect(name("tiktok")).toBe("Super Fans");
    expect(name("twitch")).toBe("Subscribers");
    expect(name("kick")).toBe("Subscribers");
    expect(name("youtube")).toBe("Members");
    expect(name(undefined)).toBe("Super Fans, subscribers, and members");
    expect(name(undefined, ["twitch", "youtube"])).toBe(
      "Subscribers and members",
    );
    expect(name(undefined, ALL, "es-419")).toBe(
      "Super Fans, suscriptores y miembros",
    );
    expect(roleName("follower", { type: TOKIO_EVENTS.CHAT }, ALL, "en")).toBe(
      "Followers",
    );
    expect(roleName("vip", { type: TOKIO_EVENTS.CHAT }, ALL, "en")).toBe(
      "VIPs",
    );
  });
});
