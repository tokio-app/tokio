import { Permissions } from "@/common/schemas";
import { UserData } from "@/common/types";
import { describe, expect, it } from "vitest";
import { hasPermission, isBlocked } from "./permissions";

const permissions = (overrides: Partial<Permissions> = {}): Permissions => ({
  all: false,
  followers: false,
  superfans: false,
  moderators: false,
  level: { enabled: false, value: 0 },
  list: { enabled: false, white: [], black: [] },
  platforms: {},
  ...overrides,
});

const user = (overrides: Partial<UserData> = {}): UserData => ({
  username: "Viewer",
  handle: "viewer",
  profilePictures: [],
  ...overrides,
});

describe("hasPermission", () => {
  it("lets everyone in when all is on", () => {
    expect(
      hasPermission(permissions({ all: true, followers: true }), user()),
    ).toBe(true);
  });

  it("lets everyone in when no role is required", () => {
    expect(hasPermission(permissions(), user())).toBe(true);
  });

  describe("list", () => {
    const list = (white: string[], black: string[]) =>
      permissions({ list: { enabled: true, white, black } });

    it("allows anyone not blacklisted when the whitelist is empty", () => {
      expect(hasPermission(list([], []), user())).toBe(true);
      expect(hasPermission(list([], ["viewer"]), user())).toBe(false);
    });

    it("only allows whitelisted handles", () => {
      expect(hasPermission(list(["viewer"], []), user())).toBe(true);
      expect(hasPermission(list(["other"], []), user())).toBe(false);
    });

    it("matches handles with or without the @, ignoring case", () => {
      expect(hasPermission(list(["@Viewer"], []), user())).toBe(true);
      expect(hasPermission(list([], [" @VIEWER "]), user())).toBe(false);
    });

    it("never matches an empty entry", () => {
      expect(hasPermission(list(["", "@"], []), user())).toBe(false);
      expect(hasPermission(list([], ["", "@"]), user())).toBe(true);
    });

    it("blacklist wins over whitelist", () => {
      expect(hasPermission(list(["viewer"], ["viewer"]), user())).toBe(false);
    });

    it("refuses a blacklisted viewer when all is on", () => {
      const p = { ...list([], ["viewer"]), all: true };
      expect(hasPermission(p, user())).toBe(false);
      expect(hasPermission(p, user({ handle: "other" }))).toBe(true);
    });

    it("keeps the role checks with only a blacklist", () => {
      const p = { ...list([], ["other"]), followers: true };
      expect(hasPermission(p, user({ follower: true }))).toBe(true);
      expect(hasPermission(p, user({ follower: false }))).toBe(false);
    });

    it("replaces the role checks with a whitelist", () => {
      const p = {
        ...list(["viewer"], []),
        followers: true,
      };
      expect(hasPermission(p, user({ follower: false }))).toBe(true);
    });
  });

  describe("roles", () => {
    it("passes with any one of the required roles", () => {
      const p = permissions({ followers: true, moderators: true });
      expect(hasPermission(p, user({ moderator: true }))).toBe(true);
      expect(hasPermission(p, user({ follower: true }))).toBe(true);
      expect(hasPermission(p, user({ superfan: true }))).toBe(false);
    });

    it("compares the fan level, treating a missing one as 0", () => {
      const p = permissions({ level: { enabled: true, value: 5 } });
      expect(hasPermission(p, user({ fanLevel: 5 }))).toBe(true);
      expect(hasPermission(p, user({ fanLevel: 4 }))).toBe(false);
      expect(hasPermission(p, user())).toBe(false);
      expect(
        hasPermission(
          permissions({ level: { enabled: true, value: 0 } }),
          user(),
        ),
      ).toBe(true);
    });
  });
});

describe("hasPermission on other platforms", () => {
  const twitch = (patch: Partial<UserData> = {}) =>
    user({ platform: "twitch", userId: "twitch:1", ...patch });
  // TikTok's rules: only followers with a fan level of 10
  const tiktokOnly = {
    all: false,
    followers: true,
    level: { enabled: true, value: 10 },
  };

  it("lets everyone in on a platform without its own rules", () => {
    expect(hasPermission(permissions(tiktokOnly), twitch())).toBe(true);
    expect(
      hasPermission(permissions(tiktokOnly), user({ platform: "kick" })),
    ).toBe(true);
    // TikTok's own still apply to TikTok
    expect(hasPermission(permissions(tiktokOnly), user())).toBe(false);
  });

  it("takes the platform's own roles: subscribers, moderators and VIPs", () => {
    const rules = permissions({
      platforms: {
        twitch: { all: false, superfans: true, moderators: false, vips: true },
        youtube: {
          all: false,
          superfans: false,
          moderators: true,
          vips: false,
        },
      },
    });

    expect(hasPermission(rules, twitch({ superfan: true }))).toBe(true);
    expect(hasPermission(rules, twitch({ vip: true }))).toBe(true);
    expect(hasPermission(rules, twitch({ moderator: true }))).toBe(false);
    expect(hasPermission(rules, twitch())).toBe(false);
    const youtube = (patch: Partial<UserData>) =>
      user({ platform: "youtube", ...patch });
    expect(hasPermission(rules, youtube({ moderator: true }))).toBe(true);
    expect(hasPermission(rules, youtube({ superfan: true }))).toBe(false);
  });

  it("lets everyone in when the platform's rules require no role", () => {
    const rules = permissions({
      platforms: {
        kick: { all: false, superfans: false, moderators: false, vips: false },
      },
    });
    expect(hasPermission(rules, user({ platform: "kick" }))).toBe(true);
  });

  it("applies the lists on every platform", () => {
    const lists = permissions({
      all: true,
      list: { enabled: true, white: [], black: ["troll"] },
    });
    expect(hasPermission(lists, twitch({ handle: "troll" }))).toBe(false);
    expect(isBlocked(lists, twitch({ handle: "troll" }))).toBe(true);

    const allowed = permissions({
      list: { enabled: true, white: ["friend"], black: [] },
      platforms: {
        twitch: { all: true, superfans: false, moderators: false, vips: false },
      },
    });
    expect(hasPermission(allowed, twitch({ handle: "friend" }))).toBe(true);
    expect(hasPermission(allowed, twitch())).toBe(false);
  });
});

describe("isBlocked", () => {
  const list = (enabled: boolean, black: string[]) =>
    permissions({ list: { enabled, white: ["other"], black } });

  it("is true for a handle on the block list while the lists are on", () => {
    expect(isBlocked(list(true, ["@Viewer"]), user())).toBe(true);
    expect(isBlocked(list(true, ["other"]), user())).toBe(false);
    expect(isBlocked(list(false, ["viewer"]), user())).toBe(false);
  });

  it("is false without a user", () => {
    expect(isBlocked(list(true, ["viewer"]), null)).toBe(false);
  });
});
