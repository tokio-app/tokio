import {
  EMOTE_TRIGGER,
  GiftEvent,
  isLiveEvent,
  Platform,
  PLATFORMS,
  TOKIO_EVENTS,
  TokioPayload,
  UserData,
} from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  createTestLive,
  generateEmoteChatSample,
  generateEventSample,
  samplePlatform,
} from ".";
import { PLATFORM_TRIGGERS, platformOf } from "../platforms";

// Twenty test LIVEs of twenty presses each, as each one picks at random,
// on every platform
const lives = Array.from({ length: 20 }, () => {
  const press = createTestLive(PLATFORMS);
  return Array.from({ length: 20 }, () => press());
});

// The viewer an event comes from, if it comes from one
const viewerOf = (payload: TokioPayload): UserData | undefined => {
  if (payload.type === "tokio:config" || !payload.data) return undefined;
  return "user" in payload.data ? payload.data.user : undefined;
};

const streakOf = ({ user, gift }: GiftEvent) => `${user.handle}:${gift.id}`;

// TikTok's gift of a press: YouTube's come too
const tiktokGift = (press: TokioPayload[]) =>
  press.find(
    (p): p is Extract<TokioPayload, { type: TOKIO_EVENTS.GIFT }> =>
      p.type === TOKIO_EVENTS.GIFT && platformOf(p.data.user) === "tiktok",
  )!.data;

// The events a platform sends live, the emote trigger being a chat
const sentBy = (platform: Platform) =>
  PLATFORM_TRIGGERS[platform].filter((type) => type !== EMOTE_TRIGGER);

describe("createTestLive", () => {
  it("sends every live event once at each press, then gifters, fans and the LIVE's platforms", () => {
    const live = Object.values(TOKIO_EVENTS).filter(isLiveEvent).sort();

    for (const press of lives.flat()) {
      const types = press.map((p) => p.type);
      expect([...new Set(types.slice(0, -3))].sort()).toEqual(live);
      expect(types.slice(-3)).toEqual([
        "tokio:gifters",
        "tokio:fans",
        "tokio:live",
      ]);
    }
  });

  it("sends emotes alone in some of the other platforms' chat, as they do", () => {
    const chats = lives
      .flat(2)
      .filter((p) => p.type === TOKIO_EVENTS.CHAT)
      .map((p) => p.data);
    const alone = chats.filter(({ comment }) => comment.content === "");

    expect(alone.length).toBeGreaterThan(0);
    for (const { user, comment } of alone) {
      expect(platformOf(user)).not.toBe("tiktok");
      expect(comment.emotes.length).toBeGreaterThan(0);
      expect(comment.emotes.every((e) => e.index === 0)).toBe(true);
    }
  });

  it("sends only the profile's platforms' events, each from its own", () => {
    const profiles: Platform[][] = [
      ["tiktok"],
      ["twitch"],
      ["youtube", "kick"],
      ["kick", "tiktok"],
    ];
    for (const platforms of profiles) {
      const press = createTestLive(platforms);
      for (let i = 0; i < 10; i++) {
        const payloads = press();
        const events = payloads.slice(0, -5);
        expect(events).toHaveLength(platforms.flatMap(sentBy).length);
        expect(payloads.slice(-5).map((p) => p.type)).toEqual([
          TOKIO_EVENTS.MUSIC_CHANGE,
          TOKIO_EVENTS.ROOM_USER,
          "tokio:gifters",
          "tokio:fans",
          "tokio:live",
        ]);
        let at = 0;
        for (const platform of platforms) {
          const end = at + sentBy(platform).length;
          const own = events.slice(at, end);
          expect(own.map((p) => p.type).sort()).toEqual(
            [...sentBy(platform)].sort(),
          );
          for (const payload of own) {
            const viewer = viewerOf(payload);
            if (viewer) expect(platformOf(viewer)).toBe(platform);
          }
          at = end;
        }

        // TikTok's gifters, ranks and fans, none without it
        const room = payloads.find((p) => p.type === TOKIO_EVENTS.ROOM_USER)!;
        const gifters = payloads.find((p) => p.type === "tokio:gifters")!;
        const fans = payloads.find((p) => p.type === "tokio:fans")!;
        const on = payloads.find((p) => p.type === "tokio:live")!;
        const ordered = PLATFORMS.filter((p) => platforms.includes(p));

        // Each platform's room, adding up to the room's numbers
        const rooms = room.data.platforms ?? [];
        expect(rooms.map((r) => r.platform)).toEqual(ordered);
        expect(rooms.reduce((sum, r) => sum + r.viewers, 0)).toBe(
          room.data.viewers,
        );
        expect(rooms.reduce((sum, r) => sum + r.views, 0)).toBe(
          room.data.views,
        );
        for (const r of rooms) {
          if (r.platform !== "tiktok") expect(r.views).toBe(0);
        }

        // The profile's platforms, on one channel
        expect(on.data.platforms.map((p) => p.platform)).toEqual(ordered);
        const [{ channel }] = on.data.platforms;
        expect(channel).toMatch(/^[a-z]+\d+$/);
        expect(on.data.platforms.every((p) => p.channel === channel)).toBe(
          true,
        );
        if (!platforms.includes("tiktok")) {
          expect(room.data.ranks).toEqual([]);
          expect(gifters.data).toEqual({ live: [], allTime: [] });
          expect(fans.data).toEqual({ fans: [] });
        }
        for (const gifter of gifters.data.allTime) {
          expect(gifter.platform).toBe("tiktok");
        }
      }
    }
  });

  it("tops this LIVE's gifters by the gifts it ended, all time on top of it", () => {
    for (const life of lives) {
      const given = new Map<string, { coins: number; gifts: number }>();

      for (const press of life) {
        const { user, gift } = tiktokGift(press);
        if (gift.repeatEnd) {
          const { coins = 0, gifts = 0 } = given.get(user.handle) ?? {};
          given.delete(user.handle);
          given.set(user.handle, {
            coins: coins + gift.comboCount * gift.coins,
            gifts: gifts + gift.comboCount,
          });
        }

        const { live, allTime } = press.find(
          (p) => p.type === "tokio:gifters",
        )!.data;
        expect(live.map(({ handle, live }) => ({ handle, ...live }))).toEqual(
          [...given]
            .sort(([, a], [, b]) => b.coins - a.coins)
            .slice(0, 10)
            .map(([handle, given]) => ({ handle, ...given })),
        );

        expect(allTime.length).toBeLessThanOrEqual(10);
        const coins = allTime.map((g) => g.allTime.coins);
        expect(coins).toEqual([...coins].sort((a, b) => b - a));
        for (const gifter of [...live, ...allTime]) {
          expect(gifter.live).toEqual(
            given.get(gifter.handle) ?? { coins: 0, gifts: 0 },
          );
          expect(gifter.allTime.coins).toBeGreaterThanOrEqual(
            gifter.live.coins,
          );
          expect(gifter.allTime.gifts).toBeGreaterThanOrEqual(
            gifter.live.gifts,
          );
        }
        // The all-time top 10 counts this LIVE's gifts too.
        for (const gifter of live) {
          const ranked = allTime.find((g) => g.handle === gifter.handle);
          if (ranked) expect(ranked).toEqual(gifter);
          else expect(gifter.allTime.coins).toBeLessThanOrEqual(coins.at(-1)!);
        }
      }
    }
  });

  it("sends the fans, highest level first, then the latest seen", () => {
    for (const press of lives.flat()) {
      const { fans } = press.find((p) => p.type === "tokio:fans")!.data;
      expect(fans.length).toBeLessThanOrEqual(100);
      fans.forEach((fan, i) => {
        expect(fan.fanLevel).toBeGreaterThan(0);
        const prev = fans[i - 1];
        if (prev && prev.fanLevel === fan.fanLevel) {
          expect(prev.seenAt).toBeGreaterThanOrEqual(fan.seenAt);
        } else if (prev) expect(prev.fanLevel).toBeGreaterThan(fan.fanLevel);
      });
    }
  });

  it("brings one new viewer a press until eight are in, and keeps them", () => {
    for (const life of lives) {
      const joined: string[] = [];
      const chatters = new Map<string, UserData>();

      for (const press of life) {
        const { user } = press.find(
          (p) => p.type === TOKIO_EVENTS.MEMBER_JOIN,
        )!.data;
        if (joined.length < 8) {
          expect(joined).not.toContain(user.handle);
          joined.push(user.handle);
        }

        for (const payload of press) {
          const viewer = viewerOf(payload);
          // The other platforms' events come from viewers of their own
          if (!viewer || (viewer.platform ?? "tiktok") !== "tiktok") continue;
          expect(joined).toContain(viewer.handle);
          if (payload.type !== TOKIO_EVENTS.CHAT) {
            expect(viewer).toMatchObject({
              follower: false,
              superfan: false,
              moderator: false,
            });
          } else {
            // Chat says the same about a viewer each time.
            expect(viewer).toEqual(chatters.get(viewer.handle) ?? viewer);
            chatters.set(viewer.handle, viewer);
          }
        }
      }
      expect(joined).toHaveLength(8);
    }
  });

  it("sends likes in batches of up to 15, and the total only grows", () => {
    for (const life of lives) {
      const likes = life
        .flat()
        .filter((p) => p.type === TOKIO_EVENTS.LIKE)
        .map((p) => p.data);
      likes.forEach(({ likeCount, totalLikes }, i) => {
        expect(likeCount).toBeGreaterThanOrEqual(1);
        expect(likeCount).toBeLessThanOrEqual(15);
        if (i > 0) {
          expect(totalLikes).toBeGreaterThanOrEqual(
            likes[i - 1].totalLikes + likeCount,
          );
        }
      });
    }
  });

  it("grows a streak over presses, then ends it once with its last count", () => {
    for (const life of lives) {
      const gifts = life.map(tiktokGift);
      let open: GiftEvent[] = [];
      for (const event of gifts) {
        if (open.length > 0) expect(streakOf(event)).toBe(streakOf(open[0]));
        if (!event.gift.repeatEnd) {
          open.push(event);
          continue;
        }

        const counts = open.map((e) => e.gift.comboCount);
        if (event.gift.type === 1) {
          expect(counts.length).toBeGreaterThan(0);
          // Strictly growing: a count sent again would be another gift.
          expect(counts).toEqual([...new Set(counts)].sort((a, b) => a - b));
          expect(event.gift.comboCount).toBe(counts.at(-1));
        } else {
          // Gifts that can't be streaks come once, ended.
          expect(counts).toEqual([]);
          expect(event.gift.comboCount).toBe(1);
        }
        open = [];
      }
    }
  });

  it("ranks the gifters by the coins of the gifts they ended", () => {
    for (const life of lives) {
      const coins = new Map<string, number>();
      const viewers: Record<string, UserData> = {};
      let watching = 0;

      for (const press of life) {
        const { user, gift } = tiktokGift(press);
        if (gift.repeatEnd) {
          viewers[user.handle] = user;
          const before = coins.get(user.handle) ?? 0;
          // A tie goes to whoever got there first.
          coins.delete(user.handle);
          coins.set(user.handle, before + gift.comboCount * gift.coins);
        }

        const room = press.find((p) => p.type === TOKIO_EVENTS.ROOM_USER)!.data;
        expect(room.viewers).toBeGreaterThanOrEqual(watching);
        const tiktok = room.platforms?.find((r) => r.platform === "tiktok");
        expect(tiktok?.views).toBeGreaterThanOrEqual(tiktok?.viewers ?? 0);
        watching = room.viewers;
        expect(room.ranks).toEqual(
          [...coins]
            .sort(([, a], [, b]) => b - a)
            .map(([handle, score], i) => ({
              username: viewers[handle].username,
              handle,
              profilePictures: viewers[handle].profilePictures,
              userId: viewers[handle].userId,
              score,
              position: i + 1,
            })),
        );
      }
    }
  });
});

describe("generateEventSample", () => {
  it("sends a gift as TikTok ends it", () => {
    for (let i = 0; i < 50; i++) {
      const { gift } = generateEventSample(TOKIO_EVENTS.GIFT).data;
      expect(gift.repeatEnd).toBe(true);
      if (gift.type !== 1) expect(gift.comboCount).toBe(1);
    }
  });

  it("samples every live event, from a platform that sends it", () => {
    for (const type of Object.values(TOKIO_EVENTS).filter(isLiveEvent)) {
      for (const platform of PLATFORMS) {
        const { data } = generateEventSample(type, platform);
        if (type === TOKIO_EVENTS.ROOM_USER) continue;
        if (!data || !("user" in data)) continue;
        const from = platformOf(data.user);
        expect(PLATFORM_TRIGGERS[from]).toContain(type);
        if (PLATFORM_TRIGGERS[platform].includes(type)) {
          expect(from).toBe(platform);
        }
      }
    }
  });

  // Many of each, as each picks at random
  const many = <T>(make: () => T) => Array.from({ length: 50 }, make);

  it("sends Twitch's events as its mapping does", () => {
    for (const { user, comment } of many(
      () => generateEventSample(TOKIO_EVENTS.CHAT, "twitch").data,
    )) {
      // No pictures in chat, the login apart from the display name
      expect(user).toMatchObject({
        profilePictures: [],
        follower: false,
        userId: expect.stringMatching(/^twitch:\d+$/),
        platform: "twitch",
        moderator: expect.any(Boolean),
        superfan: expect.any(Boolean),
        vip: expect.any(Boolean),
      });
      expect(user.handle).toBe(user.username.toLowerCase());
      expect(comment.lang).toBe("");
      expect(comment.translation).toBeUndefined();
      for (const emote of comment.emotes) {
        const id = emote.emoteID.replace("twitch:", "");
        expect(["25", "425618"]).toContain(id);
        expect(emote.images).toEqual([
          `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
        ]);
      }
    }
    for (const type of [
      TOKIO_EVENTS.FOLLOW,
      TOKIO_EVENTS.SUBSCRIBE,
      TOKIO_EVENTS.GIFT_SUB,
      TOKIO_EVENTS.CHEER,
      TOKIO_EVENTS.RAID,
      TOKIO_EVENTS.REDEEM,
    ] as const) {
      const { user } = generateEventSample(type, "twitch").data;
      // A picture looked up, and no chat badges
      expect(user.profilePictures).toEqual([expect.stringMatching(/^https:/)]);
      expect(user).not.toHaveProperty("moderator");
      expect(user).not.toHaveProperty("superfan");
    }
    for (const { tier } of many(
      () => generateEventSample(TOKIO_EVENTS.SUBSCRIBE, "twitch").data,
    )) {
      expect(["1000", "2000", "3000", "prime"]).toContain(tier);
    }
  });

  it("sends YouTube's events as its mapping does", () => {
    for (const { user, comment } of many(
      () => generateEventSample(TOKIO_EVENTS.CHAT, "youtube").data,
    )) {
      expect(user.username).toBe(user.handle);
      expect(user.userId).toMatch(/^youtube:UC/);
      expect(user.profilePictures).toHaveLength(1);
      expect(comment.lang).toBe("");
      for (const emote of comment.emotes) {
        expect(emote.emoteID).toMatch(/^youtube:/);
      }
    }
    const { user, gift } = generateEventSample(
      TOKIO_EVENTS.GIFT,
      "youtube",
    ).data;
    expect(user).not.toHaveProperty("moderator");
    expect(gift).toEqual({
      id: "youtube:vicecity_heart_v2",
      name: "Vice City heart",
      image:
        "https://www.gstatic.com/youtube/img/pdg/gift/assets/vicecity_heart_v2.png=w640-h640",
      coins: 0,
      type: 0,
      comboCount: 1,
      repeatEnd: true,
    });
    for (const type of [
      TOKIO_EVENTS.SUBSCRIBE,
      TOKIO_EVENTS.GIFT_SUB,
    ] as const) {
      expect(generateEventSample(type, "youtube").data.tier).toBe("");
    }
  });

  it("sends Kick's events as its mapping does", () => {
    for (const { user, comment } of many(
      () => generateEventSample(TOKIO_EVENTS.CHAT, "kick").data,
    )) {
      expect(user).toMatchObject({
        handle: user.username.toLowerCase(),
        profilePictures: [],
        userId: expect.stringMatching(/^kick:\d+$/),
        vip: expect.any(Boolean),
      });
      for (const emote of comment.emotes) {
        const id = emote.emoteID.replace("kick:", "");
        expect(["37226", "39275"]).toContain(id);
        expect(emote.images).toEqual([
          `https://files.kick.com/emotes/${id}/fullsize`,
        ]);
      }
    }
    // A Kicks' sender has a picture
    const kicks = generateEventSample(TOKIO_EVENTS.KICKS, "kick").data;
    expect(kicks.user.profilePictures).toHaveLength(1);
    expect(kicks.kicks).toBeGreaterThan(0);
    // Subs are found by name, with no picture and no message
    for (const { user, tier, message } of many(
      () => generateEventSample(TOKIO_EVENTS.SUBSCRIBE, "kick").data,
    )) {
      expect(user.userId).toMatch(/^kick:/);
      expect(user.profilePictures).toEqual([]);
      expect({ tier, message }).toEqual({ tier: "", message: "" });
    }
    // Hosts and redemptions name only the username
    for (const type of [TOKIO_EVENTS.RAID, TOKIO_EVENTS.REDEEM] as const) {
      const { user } = generateEventSample(type, "kick").data;
      expect(user).not.toHaveProperty("userId");
      expect(user.profilePictures).toEqual([]);
    }
  });

  it("keeps the language for TikTok's chat, and words for a test to say", () => {
    for (const platform of PLATFORMS) {
      for (const { comment } of many(() => generateEmoteChatSample(platform))) {
        expect(comment.emotes.length).toBeGreaterThan(0);
        if (platform === "tiktok") expect(comment.lang).not.toBe("");
        expect(comment.content).not.toBe("");
      }
      for (const { comment } of many(
        () => generateEventSample(TOKIO_EVENTS.CHAT, platform).data,
      )) {
        expect(comment.content).not.toBe("");
      }
    }
  });
});

describe("samplePlatform", () => {
  it("takes the row's platform, else the profile's first that sends it", () => {
    const profile: Platform[] = ["kick", "youtube", "twitch"];

    expect(samplePlatform({ type: TOKIO_EVENTS.CHAT }, profile)).toBe("kick");
    expect(samplePlatform({ type: TOKIO_EVENTS.GIFT }, profile)).toBe(
      "youtube",
    );
    expect(samplePlatform({ type: TOKIO_EVENTS.FOLLOW }, profile)).toBe(
      "twitch",
    );
    expect(
      samplePlatform({ type: TOKIO_EVENTS.CHAT, platform: "tiktok" }, profile),
    ).toBe("tiktok");
    // Music change comes from no platform; a Like from none of these
    expect(
      samplePlatform({ type: TOKIO_EVENTS.MUSIC_CHANGE }, profile),
    ).toBeUndefined();
    expect(
      samplePlatform({ type: TOKIO_EVENTS.LIKE }, profile),
    ).toBeUndefined();
  });
});
