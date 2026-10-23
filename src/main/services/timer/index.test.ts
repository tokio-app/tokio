import {
  TimerProfile,
  TimerProfileSchema,
  TimerSettings,
  TimerSettingsSchema,
} from "@/common/schemas";
import { GiftEvent, TOKIO_EVENTS, UserData } from "@/common/types";
import type { StoreManagerService } from "@/services/store";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { SAVE_INTERVAL_MS, TIMER_EVENTS, TimerService } from "./index";

type TimerEvent = (typeof TIMER_EVENTS)[number];

const MIN = 60_000;

const viewer = (handle: string): UserData => ({
  username: `${handle} name`,
  handle,
  profilePictures: [],
});

const gift = (
  comboCount: number,
  repeatEnd = false,
  coins = 5,
  handle = "fan",
): GiftEvent => ({
  user: viewer(handle),
  gift: {
    id: "rose",
    name: "Rose",
    coins,
    repeatEnd,
    type: 1,
    comboCount,
    image: "",
  },
});

const like = (likeCount: number) => ({
  user: viewer("fan"),
  likeCount,
  totalLikes: likeCount,
});

const chat = (handle: string, content = "hi") => ({
  user: viewer(handle),
  comment: { content, emotes: [], lang: "en" },
});

// The chat settings: a keyword and a cooldown in seconds
const chatRule = (cooldown: number, keyword = "") => ({
  chat: { keyword, cooldown },
});

// Settings with their defaults, and only the triggers asked for adding time
const settings = (
  patch: Partial<Omit<TimerSettings, "seconds">> = {},
  seconds: Partial<TimerSettings["seconds"]> = {},
): TimerSettings =>
  TimerSettingsSchema.parse({
    start: 10,
    ...patch,
    seconds: {
      coin: 0,
      likes: 0,
      superfan: 0,
      follow: 0,
      share: 0,
      ...seconds,
    },
  });

// Hands over an event whose type is only known at runtime
const handle = (timer: TimerService, event: TimerEvent, data: any) =>
  timer.handle(event, data);

const profile = (patch: Partial<TimerProfile> = {}): TimerProfile => ({
  ...TimerProfileSchema.parse({}),
  ...patch,
});

describe("TimerService", () => {
  let timer: TimerService;
  let updateProfileData: Mock<StoreManagerService["updateProfileData"]>;
  let changes: number[];

  const left = () => timer.get().state.remaining;
  const status = () => timer.get().state.status;

  // A loaded timer, started when asked
  const ready = (s: TimerSettings = settings(), start = true) => {
    timer.load(profile({ settings: s }), "stream.json");
    if (start) timer.control("start");
    changes.length = 0;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    timer = new TimerService();
    updateProfileData = vi.fn(async () => true);
    timer.initialize({ store: { updateProfileData } });
    changes = [];
    timer.onChange((delta) => changes.push(delta));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("controls", () => {
    it("starts from the starting time, pauses, stops and resets", () => {
      ready(settings(), false);
      expect(timer.get().state).toEqual({
        status: "idle",
        remaining: 10 * MIN,
      });

      timer.control("start");
      vi.advanceTimersByTime(MIN);
      expect(timer.get().state).toEqual({
        status: "running",
        remaining: 9 * MIN,
      });

      timer.control("pause");
      vi.advanceTimersByTime(MIN);
      expect(timer.get().state).toEqual({
        status: "paused",
        remaining: 9 * MIN,
      });

      timer.control("start");
      vi.advanceTimersByTime(MIN);
      timer.control("stop");
      vi.advanceTimersByTime(MIN);
      expect(timer.get().state).toEqual({
        status: "stopped",
        remaining: 8 * MIN,
      });

      // Start carries on after a stop
      timer.control("start");
      expect(status()).toBe("running");

      timer.control("reset");
      expect(timer.get().state).toEqual({
        status: "idle",
        remaining: 10 * MIN,
      });
      expect(changes.every((delta) => delta === 0)).toBe(true);
    });

    it("follows the starting time while idle", () => {
      ready(settings(), false);

      timer.setSettings(settings({ start: 30 }));
      expect(left()).toBe(30 * MIN);

      timer.control("start");
      timer.setSettings(settings({ start: 5 }));
      expect(left()).toBe(30 * MIN);
    });

    it("refuses Start at 0", () => {
      ready();
      timer.adjust(-20 * MIN);
      expect(timer.get().state).toEqual({ status: "stopped", remaining: 0 });

      timer.control("start");

      expect(timer.get().state).toEqual({ status: "stopped", remaining: 0 });
    });

    it("ends at 0", () => {
      ready();

      vi.advanceTimersByTime(10 * MIN);

      expect(timer.get().state).toEqual({ status: "stopped", remaining: 0 });
      expect(changes).toEqual([0]);
    });

    it("waits for an end further than a timeout can, in steps", () => {
      ready(settings({ start: 30 * 24 * 60 }));

      vi.advanceTimersByTime(2 ** 31);
      expect(status()).toBe("running");

      vi.advanceTimersByTime(30 * 24 * 60 * MIN - 2 ** 31);
      expect(timer.get().state).toEqual({ status: "stopped", remaining: 0 });
    });

    it("ends an overdue clock before a late gift adds to it", () => {
      ready(settings({}, { coin: 60 }));
      // The end's timeout hasn't run yet, as when the event loop is busy
      vi.setSystemTime(Date.now() + 10 * MIN);
      vi.spyOn(performance, "now").mockReturnValue(
        performance.now() + 10 * MIN,
      );

      timer.handle(TOKIO_EVENTS.GIFT, gift(1, true));

      expect(timer.get().state).toEqual({ status: "stopped", remaining: 0 });
    });
  });

  describe("adding time", () => {
    it("adds time only while running or paused", () => {
      ready(settings({}, { follow: 30 }), false);
      const follow = (handle: string) =>
        timer.handle(TOKIO_EVENTS.FOLLOW, { user: viewer(handle) });

      follow("a");
      expect(left()).toBe(10 * MIN);

      timer.control("start");
      follow("b");
      expect(left()).toBe(10 * MIN + 30_000);

      timer.control("pause");
      follow("c");
      expect(left()).toBe(10 * MIN + 60_000);

      timer.control("stop");
      follow("d");
      expect(left()).toBe(10 * MIN + 60_000);
      expect(changes.filter(Boolean)).toEqual([30_000, 30_000]);
    });

    it("multiplies the seconds", () => {
      ready(settings({ multiplier: 1.5 }, { superfan: 10 }));

      timer.handle(TOKIO_EVENTS.SUPER_FAN, { user: viewer("a") });

      expect(changes).toEqual([15_000]);
    });

    it.each([
      [TOKIO_EVENTS.SUPER_FAN, "superfan", { user: viewer("a") }],
      [TOKIO_EVENTS.FOLLOW, "follow", { user: viewer("a") }],
      [TOKIO_EVENTS.SHARE, "share", { user: viewer("a"), shareCount: 1 }],
      [TOKIO_EVENTS.CHAT, "chat", chat("a")],
    ] as const)("adds the seconds of %s", (event, key, data) => {
      ready(settings({}, { [key]: 7 }));

      handle(timer, event, data);

      expect(changes).toEqual([7000]);
    });

    it("adds nothing for a trigger at 0", () => {
      ready();

      for (const event of TIMER_EVENTS) {
        handle(
          timer,
          event,
          event === TOKIO_EVENTS.GIFT
            ? gift(1, true)
            : event === TOKIO_EVENTS.LIKE
              ? like(1000)
              : chat("a"),
        );
      }

      expect(changes).toEqual([]);
    });

    it("adds the coins of the gifts a streak adds, including one begun before Start", () => {
      ready(settings({}, { coin: 2 }), false);
      timer.handle(TOKIO_EVENTS.GIFT, gift(3));
      timer.control("start");
      changes.length = 0;

      timer.handle(TOKIO_EVENTS.GIFT, gift(5));
      timer.handle(TOKIO_EVENTS.GIFT, gift(5, true));
      timer.handle(TOKIO_EVENTS.GIFT, gift(1, true, -1, "other"));

      // 2 more Roses of 5 coins, 2 s each
      expect(changes).toEqual([20_000]);
    });

    it("adds the like cycles and carries the rest over", () => {
      ready(settings({}, { likes: 10, likes_every: 100 }));

      timer.handle(TOKIO_EVENTS.LIKE, like(150));
      timer.handle(TOKIO_EVENTS.LIKE, like(40));
      timer.handle(TOKIO_EVENTS.LIKE, like(220));

      expect(changes).toEqual([10_000, 30_000]);
    });

    it("adds a viewer's chat once per cooldown, and every follow and share", () => {
      ready(settings(chatRule(30), { chat: 1, follow: 5, share: 2 }));
      const share = { user: viewer("a"), shareCount: 1 };

      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("b"));
      timer.handle(TOKIO_EVENTS.FOLLOW, { user: viewer("a") });
      timer.handle(TOKIO_EVENTS.FOLLOW, { user: viewer("a") });
      timer.handle(TOKIO_EVENTS.SHARE, share);
      timer.handle(TOKIO_EVENTS.SHARE, share);
      expect(changes).toEqual([1000, 1000, 5000, 5000, 2000, 2000]);

      vi.advanceTimersByTime(30_000);
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));
      expect(changes.at(-1)).toBe(1000);
    });

    it("adds only the chat that has the keyword, matched like chat alerts", () => {
      ready(settings(chatRule(0, "!time"), { chat: 3 }));

      timer.handle(TOKIO_EVENTS.CHAT, chat("a", "hi"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("a", "go !time"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("b", "!TIME please"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("c", "!timeout"));

      expect(changes).toEqual([3000, 3000]);
    });

    it("doesn't start a viewer's cooldown with a message that adds nothing", () => {
      ready(settings(chatRule(30, "!time"), { chat: 3 }));

      timer.handle(TOKIO_EVENTS.CHAT, chat("a", "hi"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("a", "!time"));

      expect(changes).toEqual([3000]);
    });

    it("forgets the cooldowns on Reset and on a disconnect", () => {
      ready(settings(chatRule(30), { chat: 1 }));
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));

      timer.disconnected();
      timer.control("start");
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));

      timer.control("reset");
      timer.control("start");
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));

      expect(changes.filter(Boolean)).toEqual([1000, 1000, 1000]);
    });

    it("counts every chat without a cooldown", () => {
      ready(settings(chatRule(0), { chat: 1 }));

      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));

      expect(changes).toEqual([1000, 1000]);
    });

    it("stops added time at the cap, without cutting the start", () => {
      ready(settings({ start: 10, cap: 11 }, { superfan: 45 }));
      const superfan = () =>
        timer.handle(TOKIO_EVENTS.SUPER_FAN, { user: viewer("a") });

      superfan();
      superfan();
      expect(left()).toBe(11 * MIN);
      expect(changes).toEqual([45_000, 15_000]);

      timer.adjust(5 * MIN);
      expect(left()).toBe(11 * MIN);

      timer.setSettings(settings({ start: 10, cap: 5 }, { superfan: 45 }));
      superfan();
      expect(left()).toBe(11 * MIN);
    });

    it("adds and removes time by hand, exactly, down to 0", () => {
      ready(settings({ multiplier: 3 }));

      timer.adjust(5 * MIN);
      expect(left()).toBe(15 * MIN);

      timer.control("pause");
      timer.adjust(-20 * MIN);
      expect(timer.get().state).toEqual({ status: "paused", remaining: 0 });
      expect(changes).toEqual([5 * MIN, 0, -15 * MIN]);
    });

    it("ends a running clock removed down to 0", () => {
      ready();

      timer.adjust(-11 * MIN);

      expect(timer.get().state).toEqual({ status: "stopped", remaining: 0 });
      expect(changes).toContain(-10 * MIN);
    });

    it("leaves an idle clock alone", () => {
      ready(settings(), false);

      timer.adjust(MIN);

      expect(left()).toBe(10 * MIN);
      expect(changes).toEqual([]);
    });
  });

  describe("profiles and saving", () => {
    it("loads a running timer paused, with the time it had", () => {
      timer.load(
        profile({ settings: settings(), status: "running", remaining: 90_000 }),
        "stream.json",
      );

      expect(timer.get().state).toEqual({
        status: "paused",
        remaining: 90_000,
      });
      expect(changes).toEqual([0]);
    });

    it("pauses on a disconnect when pause_on_end is on", () => {
      ready();
      vi.advanceTimersByTime(MIN);

      expect(timer.disconnected()).toBe(true);
      expect(timer.get().state).toEqual({
        status: "paused",
        remaining: 9 * MIN,
      });
      expect(timer.disconnected()).toBe(false);
    });

    it("keeps running on a disconnect when pause_on_end is off", () => {
      ready(settings({ pause_on_end: false }));

      expect(timer.disconnected()).toBe(false);
      expect(status()).toBe("running");
    });

    it("saves into the file it was loaded from, as it was when asked", async () => {
      ready();
      vi.advanceTimersByTime(MIN);
      updateProfileData.mockClear();

      const saving = timer.save();
      timer.load(profile(), "other.json");
      expect(await saving).toBe(true);

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith(
        {
          timer: {
            settings: settings(),
            status: "running",
            remaining: 9 * MIN,
          },
        },
        "stream.json",
      );
    });

    it("saves nothing before a load", async () => {
      expect(await timer.save()).toBe(true);
      expect(updateProfileData).not.toHaveBeenCalled();
    });

    it("reports a save that failed", async () => {
      ready();
      updateProfileData.mockResolvedValueOnce(false);

      expect(await timer.save()).toBe(false);
    });

    it("saves on the interval only when time was added or the clock runs", async () => {
      ready(settings({}, { follow: 30 }), false);
      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
      expect(updateProfileData).not.toHaveBeenCalled();

      timer.control("start");
      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
      expect(updateProfileData).toHaveBeenCalledOnce();

      timer.control("pause");
      await timer.save();
      updateProfileData.mockClear();
      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
      expect(updateProfileData).not.toHaveBeenCalled();

      timer.handle(TOKIO_EVENTS.FOLLOW, { user: viewer("a") });
      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          timer: expect.objectContaining({
            status: "paused",
            remaining: 10 * MIN - SAVE_INTERVAL_MS + 30_000,
          }),
        }),
        "stream.json",
      );
    });

    it("saves the end of a clock that ran out", async () => {
      ready();
      vi.advanceTimersByTime(10 * MIN - 1000);
      updateProfileData.mockClear();

      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          timer: expect.objectContaining({ status: "stopped", remaining: 0 }),
        }),
        "stream.json",
      );
    });

    it("prunes the cooldowns that ended", async () => {
      ready(settings(chatRule(1), { chat: 1 }));
      timer.handle(TOKIO_EVENTS.CHAT, chat("a"));

      await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);

      expect(timer["_cooldowns"].size).toBe(0);
    });
  });
});
