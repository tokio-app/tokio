import { Permissions } from "@/common/schemas";
import { UserData } from "@/common/types";
import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";

const permissions = (overrides: Partial<Permissions> = {}): Permissions => ({
  all: false,
  followers: false,
  superfans: false,
  moderators: false,
  level: { enabled: false, value: 0 },
  list: { enabled: false, white: [], black: [] },
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

    it("replaces the role checks", () => {
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
