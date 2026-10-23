import {
  GiftEvent,
  isLiveEvent,
  TOKIO_EVENTS,
  TokioPayload,
  UserData,
} from "@/common/types";
import { describe, expect, it } from "vitest";
import { createTestLive, generateTikTokEventSample } from ".";

// Twenty test LIVEs of twenty presses each, as each one picks at random
const lives = Array.from({ length: 20 }, () => {
  const press = createTestLive();
  return Array.from({ length: 20 }, () => press());
});

// The viewer an event comes from, if it comes from one
const viewerOf = (payload: TokioPayload): UserData | undefined => {
  if (payload.type === "tokio:config" || !payload.data) return undefined;
  return "user" in payload.data ? payload.data.user : undefined;
};

const streakOf = ({ user, gift }: GiftEvent) => `${user.handle}:${gift.id}`;

describe("createTestLive", () => {
  it("sends every live event once at each press", () => {
    const live = Object.values(TOKIO_EVENTS).filter(isLiveEvent).sort();

    for (const press of lives.flat()) {
      expect(press.map((p) => p.type).sort()).toEqual(live);
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
          if (!viewer) continue;
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
      const gifts = life
        .flat()
        .filter((p) => p.type === TOKIO_EVENTS.GIFT)
        .map((p) => p.data);
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
        const { user, gift } = press.find(
          (p) => p.type === TOKIO_EVENTS.GIFT,
        )!.data;
        if (gift.repeatEnd) {
          viewers[user.handle] = user;
          coins.set(
            user.handle,
            (coins.get(user.handle) ?? 0) + gift.comboCount * gift.coins,
          );
        }

        const room = press.find((p) => p.type === TOKIO_EVENTS.ROOM_USER)!.data;
        expect(room.viewers).toBeGreaterThanOrEqual(watching);
        expect(room.views).toBeGreaterThanOrEqual(room.viewers);
        watching = room.viewers;
        expect(room.ranks).toEqual(
          [...coins]
            .sort(([, a], [, b]) => b - a)
            .map(([handle, score], i) => ({
              username: viewers[handle].username,
              handle,
              profilePictures: viewers[handle].profilePictures,
              score,
              position: i + 1,
            })),
        );
      }
    }
  });
});

describe("generateTikTokEventSample", () => {
  it("sends a gift as TikTok ends it", () => {
    for (let i = 0; i < 50; i++) {
      const { gift } = generateTikTokEventSample(TOKIO_EVENTS.GIFT).data;
      expect(gift.repeatEnd).toBe(true);
      if (gift.type !== 1) expect(gift.comboCount).toBe(1);
    }
  });
});
