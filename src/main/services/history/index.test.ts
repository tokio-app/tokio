import {
  GiftEvent,
  LiveRecord,
  LiveSummary,
  SuperChatEvent,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import Logger from "@/logger";
import { JSONManagerService } from "@/services/json";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService, MAX_GIFTERS, MAX_LIVES, TOP_GIFTERS } from "./index";

// A test can make a removal fail
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});

const viewer = (userId: string, handle = `fan${userId}`) =>
  ({
    userId,
    username: `${handle} name`,
    handle,
    profilePictures: [`https://p16/${handle}.jpg`, `https://p19/${handle}.jpg`],
  }) satisfies UserData;

const kicker = (userId: string, handle = `fan${userId}`) => ({
  ...viewer(userId, handle),
  platform: "kick" as const,
});

const twitcher = (userId: string, handle = `fan${userId}`) => ({
  ...viewer(userId, handle),
  platform: "twitch" as const,
});

const tuber = (userId: string, handle = `fan${userId}`) => ({
  ...viewer(userId, handle),
  platform: "youtube" as const,
});

const superChat = (
  user: UserData,
  amount: string,
  usd?: number | null,
): SuperChatEvent => ({ user, amount, message: "", sticker: "", usd });

const MINUTE = 60_000;

const gift = (
  user: UserData,
  coins: number,
  comboCount = 1,
  repeatEnd = true,
): GiftEvent => ({
  user,
  gift: {
    id: "5655",
    coins,
    repeatEnd,
    type: 1,
    name: "Rose",
    comboCount,
    image: "",
  },
});

describe("HistoryService", () => {
  let dir: string;
  let json: JSONManagerService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    json = new JSONManagerService();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  const service = () => {
    const history = new HistoryService();
    history.initialize({ json, folder: dir });
    return history;
  };

  const loaded = async (file = "a.json") => {
    const history = service();
    await history.load(file);
    return history;
  };

  // Sends each gift at its own time
  const gifts = (history: HistoryService, ...sent: [number, GiftEvent][]) => {
    for (const [at, event] of sent) {
      vi.setSystemTime(at);
      history.record(TOKIO_EVENTS.GIFT, event);
    }
  };

  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(join(dir, "a", file), "utf-8"));

  it("counts a LIVE's gifts, a combo once", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    const ana = viewer("1", "ana");
    gifts(
      history,
      [1100, gift(ana, 5, 1, false)],
      [1200, gift(ana, 5, 2, false)],
      [1300, gift(ana, 5, 3, false)],
      [1400, gift(ana, 5, 3, true)],
      // No id: the totals only
      [1500, gift({ ...viewer("2"), userId: "" }, 100)],
    );
    history.end(2000);

    expect(history.getHistory()).toEqual({
      lives: [
        {
          username: "kai",
          startedAt: 1000,
          endedAt: 2000,
          coins: 115,
          gifts: 4,
          platforms: { tiktok: { amount: 115, gifts: 4, giftSubs: 0 } },
        },
      ],
      gifters: [
        {
          userId: "1",
          username: "ana name",
          handle: "ana",
          picture: "https://p16/ana.jpg",
          coins: 15,
          gifts: 3,
          giftSubs: 0,
          giftedAt: 1300,
        },
      ],
    });
  });

  it("counts nothing before a load or outside a LIVE", async () => {
    const history = service();
    history.start("kai", 1000);
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
    await history.load("a.json");
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
    history.end(2000);

    expect(history.top()).toEqual({ live: [], allTime: [] });
    expect(history.getHistory()).toEqual({ lives: [], gifters: [] });
  });

  it("takes a gifter's name, handle and picture from their latest gift", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(
      history,
      [1, gift(viewer("1", "ana"), 1)],
      [2, gift({ ...viewer("1", "ana_2"), username: "Ana" }, 1)],
      [3, gift({ ...viewer("1", "ana_3"), profilePictures: [] }, 1)],
    );

    expect(history.top().live).toEqual([
      {
        userId: "1",
        username: "ana_3 name",
        handle: "ana_3",
        picture: "https://p16/ana_2.jpg",
        live: { coins: 3, gifts: 3 },
        allTime: { coins: 3, gifts: 3 },
        giftedAt: 3,
      },
    ]);
  });

  it("keeps a gifter's platform, through a save and a load", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(history, [1, gift(kicker("kick:1"), 5)]);

    expect(history.top().live[0].platform).toBe("kick");
    history.end(10);
    expect(await history.save()).toBe(true);

    const again = await loaded();
    expect(again.getHistory().gifters[0].platform).toBe("kick");
    expect(again.top().allTime[0].platform).toBe("kick");
  });

  it("gives each platform's own top gifters in this LIVE", async () => {
    const history = await loaded();
    expect(history.topByPlatform()).toEqual({});
    history.start("kai", 0);
    gifts(
      history,
      [1, gift(viewer("ana"), 30)],
      [2, gift(kicker("kick:1"), 5)],
      [3, gift(kicker("kick:2"), 20)],
    );

    const tops = history.topByPlatform();
    expect(tops.tiktok?.map((g) => g.userId)).toEqual(["ana"]);
    expect(tops.kick?.map((g) => g.userId)).toEqual(["kick:2", "kick:1"]);
    expect(tops.kick?.[0]).toMatchObject({ coins: 20, gifts: 1 });

    history.end(10);
    expect(history.topByPlatform()).toEqual({});
  });

  it("counts a gift without a price in the totals only, with no gifter", async () => {
    const history = await loaded();
    history.start("kai", 0);
    const yui = { ...viewer("youtube:UC1"), platform: "youtube" as const };
    gifts(history, [1, gift(yui, 0)], [2, gift(yui, 0)]);

    expect(history.top().live).toEqual([]);
    history.end(10);
    await history.save();

    expect(history.getHistory()).toMatchObject({
      lives: [{ coins: 0, gifts: 2 }],
      gifters: [],
    });
    expect((await read<LiveRecord>("0.json")).minutes).toEqual([
      { minute: 0, gifters: { "youtube:": [0, 2, 0] } },
    ]);
  });

  it("counts Kick's Kicks apart from TikTok's coins", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(
      history,
      [1, gift(viewer("1"), 5)],
      [2, gift(kicker("kick:1"), 100, 2)],
      // No id: the totals only, under "kick:"
      [3, gift({ ...kicker("kick:2"), userId: "" }, 10)],
    );
    history.end(10);
    await history.save();

    expect(history.getHistory().lives).toEqual([
      expect.objectContaining({
        coins: 5,
        gifts: 4,
        platforms: {
          tiktok: { amount: 5, gifts: 1, giftSubs: 0 },
          kick: { amount: 210, gifts: 3, giftSubs: 0 },
        },
      }),
    ]);
    expect((await read<LiveRecord>("0.json")).minutes).toEqual([
      {
        minute: 0,
        gifters: {
          1: [5, 1, 0],
          "kick:1": [200, 2, 0],
          "kick:": [10, 1, 0],
        },
      },
    ]);
  });

  it("splits a cut LIVE's totals by each gift's currency", async () => {
    const history = await loaded();
    history.start("kai", 10 * MINUTE);
    gifts(
      history,
      [10 * MINUTE + 1000, gift(viewer("1"), 999)],
      [11 * MINUTE, gift(viewer("1"), 5)],
      [11 * MINUTE + 1000, gift(kicker("kick:1"), 100)],
      [11 * MINUTE + 2000, gift({ ...kicker("kick:2"), userId: "" }, 10)],
      [11 * MINUTE + 3000, gift({ ...viewer("2"), userId: "" }, 3)],
    );
    history.end(12 * MINUTE);

    expect(await history.getTotals({ from: 11 * MINUTE })).toEqual({
      coins: 8,
      gifts: 4,
      platforms: {
        tiktok: { amount: 8, gifts: 2, giftSubs: 0 },
        kick: { amount: 110, gifts: 2, giftSubs: 0 },
      },
    });
  });

  it("ranks and lists each platform's gifters on their own", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(
      history,
      [1, gift(viewer("a"), 100)],
      [2, gift(kicker("kick:a"), 50)],
      [3, gift(viewer("b"), 20)],
      [4, gift(kicker("kick:b", "bea"), 500)],
    );
    history.end(10);

    // In one list by amount, each with their place in their currency
    const all = ["kick:b", "a", "kick:a", "b"];
    expect(history.getHistory().gifters.map((g) => g.userId)).toEqual(all);
    const places = async (range: { from?: number; query?: string }) =>
      (await history.getGifters(range))?.map((g) => [g.userId, g.rank]);
    const ranked = await places({});
    expect(ranked).toEqual([
      ["kick:b", 1],
      ["a", 1],
      ["kick:a", 2],
      ["b", 2],
    ]);
    expect(await places({ query: "bea" })).toEqual([["kick:b", 1]]);
    // Dates read from the files rank the same
    expect(await places({ from: 3 })).toEqual(ranked);
    // Overlays' lists stay mixed
    expect(history.top().allTime.map((g) => g.userId)).toEqual(all);
  });

  it("reads LIVEs saved before other platforms with no parts of their own", async () => {
    await mkdir(join(dir, "a"), { recursive: true });
    const live = {
      username: "kai",
      startedAt: 0,
      endedAt: 10,
      coins: 5,
      gifts: 1,
    };
    await writeFile(
      join(dir, "a", "index.json"),
      JSON.stringify({ lives: [live], gifters: [], newest: 0 }),
    );
    await writeFile(
      join(dir, "a", "0.json"),
      JSON.stringify({ ...live, gifters: [] }),
    );

    const history = await loaded();

    expect(history.getHistory().lives).toEqual([{ ...live, platforms: {} }]);
    expect(await history.getLive(0)).toMatchObject({ platforms: {} });
  });

  it("reads a platform it doesn't know as TikTok's", async () => {
    await mkdir(join(dir, "a"), { recursive: true });
    const gifter = {
      userId: "1",
      username: "ana",
      handle: "ana",
      picture: "",
      coins: 1,
      gifts: 1,
      giftedAt: 1,
    };
    await writeFile(
      join(dir, "a", "index.json"),
      JSON.stringify({
        lives: [],
        gifters: [{ ...gifter, platform: "rumble" }],
        newest: 0,
      }),
    );

    const history = await loaded();

    expect(history.getHistory().gifters).toEqual([{ ...gifter, giftSubs: 0 }]);
  });

  it("keeps a gifter's picture from an earlier LIVE", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(history, [1, gift(viewer("1", "ana"), 1)]);
    history.end(10);
    history.start("kai", 20);
    gifts(history, [
      30,
      gift({ ...viewer("1", "ana"), profilePictures: [] }, 1),
    ]);

    expect(history.top().live[0].picture).toBe("https://p16/ana.jpg");
    history.end(40);
    expect(history.getHistory().gifters[0].picture).toBe("https://p16/ana.jpg");
    expect(history.top().allTime[0].picture).toBe("https://p16/ana.jpg");
  });

  it("ranks both lists by coins, ties to whoever got there first", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(
      history,
      [10, gift(viewer("a"), 100)],
      [20, gift(viewer("b"), 50)],
      [30, gift(viewer("c"), 50)],
    );
    history.end(35);
    history.start("kai", 40);
    gifts(
      history,
      [50, gift(viewer("d"), 10)],
      [60, gift(viewer("e"), 10)],
      [70, gift(viewer("b"), 60)],
    );

    const { live, allTime } = history.top();
    expect(live.map((g) => g.userId)).toEqual(["b", "d", "e"]);
    expect(allTime.map((g) => g.userId)).toEqual(["b", "a", "c", "d", "e"]);
    expect(allTime.slice(0, 2)).toEqual([
      expect.objectContaining({
        handle: "fanb",
        live: { coins: 60, gifts: 1 },
        allTime: { coins: 110, gifts: 2 },
        giftedAt: 70,
      }),
      expect.objectContaining({
        live: { coins: 0, gifts: 0 },
        allTime: { coins: 100, gifts: 1 },
        giftedAt: 10,
      }),
    ]);

    history.end(80);
    expect(history.top().live).toEqual([]);
  });

  it(`adds this LIVE to the finished ones' top ${TOP_GIFTERS}`, async () => {
    const history = await loaded();
    history.start("kai", 0);
    for (let i = 1; i <= TOP_GIFTERS + 1; i++)
      gifts(history, [i, gift(viewer(String(i)), i * 10)]);
    history.end(100);
    history.start("kai", 200);
    // Last of the finished LIVE's, first with this one
    gifts(history, [300, gift(viewer("1"), 200)]);

    const { live, allTime } = history.top();
    expect(live.map((g) => g.userId)).toEqual(["1"]);
    expect(allTime.map((g) => g.userId)).toEqual([
      "1",
      ...["11", "10", "9", "8", "7", "6", "5", "4", "3"],
    ]);
    expect(allTime[0].allTime).toEqual({ coins: 210, gifts: 2 });
  });

  it(`keeps every gifter in a LIVE's file and ${MAX_GIFTERS} of each currency in all time`, async () => {
    const history = await loaded();
    history.start("kai", 0);
    for (let i = 0; i < MAX_GIFTERS - 1; i++)
      gifts(history, [10, gift(viewer(String(i)), 5)]);
    // The fewest coins, and the older one is dropped
    gifts(history, [1, gift(viewer("old"), 1)], [2, gift(viewer("new"), 1)]);
    // Kicks have their own cap
    gifts(history, [3, gift(kicker("kick:1"), 1)]);
    history.end(100);
    expect(await history.save()).toBe(true);

    const record = await read<LiveRecord>("0.json");
    expect(record.gifters).toHaveLength(MAX_GIFTERS + 2);
    expect(record.endedAt).toBe(100);
    const index = await read<{
      lives: LiveSummary[];
      gifters: { userId: string }[];
    }>("index.json");
    const { gifters, minutes, ...summary } = record;
    expect(minutes).toEqual([expect.objectContaining({ minute: 0 })]);
    expect(index.lives).toEqual([summary]);
    const ids = index.gifters.map((g) => g.userId);
    expect(ids).toHaveLength(MAX_GIFTERS + 1);
    expect(ids).not.toContain("old");
    expect(ids.slice(-2)).toEqual(["new", "kick:1"]);
    expect(gifters[0]).toEqual(index.gifters[0]);
  });

  it("writes only the LIVE's own file while it goes on, and the index at its end", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    gifts(history, [1100, gift(viewer("1"), 5)]);
    vi.setSystemTime(5000);

    expect(await history.save()).toBe(true);
    expect(await readdir(join(dir, "a"))).toEqual(["1000.json"]);
    expect(await read<LiveRecord>("1000.json")).toEqual(
      expect.objectContaining({ endedAt: 5000, coins: 5 }),
    );

    history.end(6000);
    expect(await history.save()).toBe(true);
    expect((await readdir(join(dir, "a"))).sort()).toEqual([
      "1000.json",
      "index.json",
    ]);
    expect((await read<LiveRecord>("1000.json")).endedAt).toBe(6000);
  });

  it("moves a quiet LIVE's end on with each save", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    gifts(history, [1100, gift(viewer("1"), 5)]);
    vi.setSystemTime(5000);
    await history.save();
    // Nothing came since the last save
    vi.setSystemTime(40_000);

    expect(await history.save()).toBe(true);
    expect((await read<LiveRecord>("1000.json")).endedAt).toBe(40_000);
    expect((await loaded()).getHistory().lives).toEqual([
      expect.objectContaining({ startedAt: 1000, endedAt: 40_000, coins: 5 }),
    ]);
  });

  it("loads a saved history back, and writes nothing when unchanged", async () => {
    expect(await service().load("a.json")).toBe(true);
    const empty = await loaded();
    expect(await empty.save()).toBe(true);
    expect(existsSync(join(dir, "a"))).toBe(false);

    const history = await loaded();
    history.start("kai", 1000);
    gifts(history, [1100, gift(viewer("1"), 5)], [1200, gift(viewer("2"), 9)]);
    history.end(2000);
    await history.save();

    const saveFile = vi.spyOn(json, "saveArbitraryFile");
    expect(await history.save()).toBe(true);
    const again = await loaded();
    expect(again.getHistory()).toEqual(history.getHistory());
    expect(again.top()).toEqual(history.top());
    expect(await again.getLive(1000)).toEqual(
      expect.objectContaining({ gifters: history.getHistory().gifters }),
    );
    expect(await again.save()).toBe(true);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it.each([
    ["isn't JSON", "{ broken"],
    ["holds something else", '{ "lives": [{ "startedAt": "x" }] }'],
  ])(
    "leaves an index that %s as it is, and records nothing",
    async (_, content) => {
      const path = join(dir, "a", "index.json");
      await mkdir(join(dir, "a"));
      await writeFile(path, content);
      const warn = vi.spyOn(Logger, "warn");
      const history = service();
      expect(await history.load("a.json")).toBe(false);
      history.start("kai", 1000);
      history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
      history.end(2000);

      expect(history.top()).toEqual({ live: [], allTime: [] });
      expect(await history.save()).toBe(true);
      // Nothing to clear either, so the page says it couldn't
      expect(await history.clear()).toBe(false);
      expect(await readFile(path, "utf-8")).toBe(content);
      expect(await readdir(join(dir, "a"))).toEqual(["index.json"]);
      expect(warn).toHaveBeenCalledWith(
        `<History> Not recording LIVEs, ${path} didn't load`,
        undefined,
      );
    },
  );

  it("saves into the folder the history came from when another profile loads meanwhile", async () => {
    const history = await loaded("a.json");
    history.start("kai", 1000);
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
    const saving = history.save();
    await history.load("b.json");

    expect(await saving).toBe(true);
    expect((await read<LiveRecord>("1000.json")).coins).toBe(5);
    expect(history.top()).toEqual({ live: [], allTime: [] });
    expect(existsSync(join(dir, "b"))).toBe(false);
  });

  it("keeps the latest load when an earlier one ends after it", async () => {
    const before = await loaded("a.json");
    before.start("kai", 1000);
    before.end(2000);
    await before.save();

    const history = service();
    const first = history.load("a.json");
    await history.load("b.json");
    await first;

    expect(history.getHistory().lives).toEqual([]);
  });

  it("checks only the index on a save", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
    history.end(2000);
    const saveFile = vi.spyOn(json, "saveFile");

    expect(await history.save()).toBe(true);
    expect(saveFile.mock.calls.map(([file]) => file)).toEqual([
      join(dir, "a", "index.json"),
    ]);
    expect((await read<LiveRecord>("1000.json")).coins).toBe(5);
  });

  it("tries a failed save again on the next one", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
    history.end(2000);
    // The LIVE's file fails, so the index listing it waits too
    const saveFile = vi
      .spyOn(json, "saveArbitraryFile")
      .mockResolvedValueOnce(false);

    expect(await history.save()).toBe(false);
    expect(saveFile).toHaveBeenCalledOnce();
    expect(existsSync(join(dir, "a", "index.json"))).toBe(false);
    expect(await history.getLive(1000)).toEqual(
      expect.objectContaining({ coins: 5 }),
    );
    expect(await history.save()).toBe(true);
    expect(saveFile).toHaveBeenCalledTimes(3);
    expect((await read<LiveRecord>("1000.json")).endedAt).toBe(2000);
    expect(await history.save()).toBe(true);
    expect(saveFile).toHaveBeenCalledTimes(3);
  });

  it("adds a LIVE a crash left once, and removes an older one a delete left", async () => {
    const before = await loaded();
    before.start("kai", 1000);
    before.end(2000);
    before.start("kai", 3000);
    gifts(before, [3100, gift(viewer("1"), 5)]);
    vi.setSystemTime(4000);
    await before.save();
    const left = await read<LiveRecord>("1000.json");
    await writeFile(
      join(dir, "a", "500.json"),
      JSON.stringify({ ...left, startedAt: 500 }),
    );

    const history = await loaded();
    expect(history.getHistory().lives.map((l) => l.endedAt)).toEqual([
      4000, 2000,
    ]);
    expect(history.getHistory().gifters).toEqual([
      expect.objectContaining({ userId: "1", coins: 5 }),
    ]);
    expect(existsSync(join(dir, "a", "500.json"))).toBe(false);
    expect((await read<{ lives: LiveSummary[] }>("index.json")).lives).toEqual(
      history.getHistory().lives.reverse(),
    );

    expect((await loaded()).getHistory()).toEqual(history.getHistory());
  });

  it("keeps the minutes a LIVE's gifts came in, in its file and not the index", async () => {
    const history = await loaded();
    // 30 s into the clock's minute 10
    const start = 10 * MINUTE + 30_000;
    history.start("kai", start);
    gifts(
      history,
      [start + 10_000, gift(viewer("1"), 5)],
      [start + 20_000, gift(viewer("1"), 5)],
      [start + 40_000, gift(viewer("2"), 100)],
      // No id: the minute's totals only
      [start + 50_000, gift({ ...viewer("3"), userId: "" }, 1)],
      [start + 100_000, gift(viewer("1"), 2)],
    );
    history.end(start + 120_000);
    await history.save();

    expect((await read<LiveRecord>(`${start}.json`)).minutes).toEqual([
      { minute: 0, gifters: { 1: [10, 2, 0] } },
      { minute: 1, gifters: { 2: [100, 1, 0], "": [1, 1, 0] } },
      { minute: 2, gifters: { 1: [2, 1, 0] } },
    ]);
    const { lives } = await read<{ lives: LiveSummary[] }>("index.json");
    expect(lives).toEqual([
      {
        username: "kai",
        startedAt: start,
        endedAt: start + 120_000,
        coins: 113,
        gifts: 5,
        platforms: { tiktok: { amount: 113, gifts: 5, giftSubs: 0 } },
      },
    ]);
  });

  it("writes a minute as it was when the save began", async () => {
    const history = await loaded();
    history.start("kai", 0);
    gifts(
      history,
      [1000, gift(viewer("1"), 5)],
      [MINUTE, gift(viewer("1"), 5)],
    );
    const saving = history.save();
    // Lands while the save waits for the one before
    gifts(history, [MINUTE + 1000, gift(viewer("1"), 5)]);
    await saving;

    expect((await read<LiveRecord>("0.json")).minutes).toEqual([
      { minute: 0, gifters: { 1: [5, 1, 0] } },
      { minute: 1, gifters: { 1: [5, 1, 0] } },
    ]);
  });

  it("counts only the gifts in the dates of a LIVE they cut", async () => {
    const history = await loaded();
    // From 10:30 to 12:30 into the clock's minutes, then from 20 to 21
    const start = 10 * MINUTE + 30_000;
    history.start("kai", start);
    gifts(
      history,
      [start + 10_000, gift(viewer("1"), 5)],
      [start + 40_000, gift(viewer("2"), 100)],
      [start + 50_000, gift(viewer("1"), 7)],
      [start + 55_000, gift({ ...viewer("3"), userId: "" }, 3)],
    );
    history.end(start + 120_000);
    history.start("kai", 20 * MINUTE);
    gifts(history, [20 * MINUTE + 1000, gift(viewer("2"), 1)]);
    history.end(21 * MINUTE);

    // The first LIVE from its second minute, and all of the second
    const since = { from: 11 * MINUTE };
    expect(await history.getTotals(since)).toEqual({
      coins: 111,
      gifts: 4,
      platforms: { tiktok: { amount: 111, gifts: 4, giftSubs: 0 } },
    });
    expect(await history.getGifters(since)).toEqual([
      expect.objectContaining({ userId: "2", coins: 101, gifts: 2, rank: 1 }),
      expect.objectContaining({ userId: "1", coins: 7, gifts: 1, rank: 2 }),
    ]);

    // The first LIVE's first minute
    const until = { to: 11 * MINUTE };
    expect(await history.getTotals(until)).toEqual({
      coins: 5,
      gifts: 1,
      platforms: { tiktok: { amount: 5, gifts: 1, giftSubs: 0 } },
    });
    expect(await history.getGifters(until)).toEqual([
      expect.objectContaining({ userId: "1", coins: 5, rank: 1 }),
    ]);

    // Both minutes the dates start and end in count
    const across = { from: 10 * MINUTE + 20_000, to: 11 * MINUTE + 20_000 };
    expect(await history.getTotals(across)).toEqual({
      coins: 115,
      gifts: 4,
      platforms: { tiktok: { amount: 115, gifts: 4, giftSubs: 0 } },
    });

    // Whole LIVEs come from the list, as do the dates of one LIVE
    expect(await history.getTotals({})).toEqual({
      coins: 116,
      gifts: 5,
      platforms: { tiktok: { amount: 116, gifts: 5, giftSubs: 0 } },
    });
    expect(
      await history.getGifters({ from: start, to: start + 120_000 }),
    ).toEqual([
      expect.objectContaining({ userId: "2", coins: 100, rank: 1 }),
      expect.objectContaining({ userId: "1", coins: 12, rank: 2 }),
    ]);
    expect(await history.getTotals({ from: 30 * MINUTE })).toEqual({
      coins: 0,
      gifts: 0,
      platforms: {},
    });
  });

  it("adds up the gifters of the LIVEs in some dates", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    gifts(
      history,
      [1100, gift(viewer("a"), 100)],
      [1200, gift(viewer("b"), 20)],
    );
    history.end(2000);
    history.start("kai", 3000);
    gifts(history, [3100, gift(viewer("a", "a_new"), 50)]);
    history.end(4000);
    await history.save();

    expect(await history.getGifters({})).toEqual([
      expect.objectContaining({ userId: "a", handle: "a_new", coins: 150 }),
      expect.objectContaining({ userId: "b", coins: 20 }),
    ]);
    // From included, to left out
    expect(await history.getGifters({ from: 3000 })).toEqual([
      expect.objectContaining({ userId: "a", coins: 50, gifts: 1, rank: 1 }),
    ]);
    expect(await history.getGifters({ to: 3000 })).toEqual([
      expect.objectContaining({ userId: "a", handle: "fana", coins: 100 }),
      expect.objectContaining({ userId: "b", coins: 20, rank: 2 }),
    ]);
    expect(await history.getGifters({ from: 5000 })).toEqual([]);

    await writeFile(join(dir, "a", "1000.json"), "{ broken");
    expect(await history.getGifters({ to: 3000 })).toEqual([]);
    // A range of every LIVE is all time's list, read from no file
    expect(await history.getGifters({ from: 0 })).toEqual([
      expect.objectContaining({ userId: "a", coins: 150, rank: 1 }),
      expect.objectContaining({ userId: "b", coins: 20, rank: 2 }),
    ]);
  });

  it("searches gifters by name or @handle, keeping their places", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    gifts(
      history,
      [1100, gift(viewer("a", "ana.bakes"), 100)],
      [1200, gift(viewer("b", "beto"), 20)],
    );
    history.end(2000);
    history.start("kai", 3000);
    gifts(history, [3100, gift(viewer("c", "caro"), 5)]);
    history.end(4000);

    // Any case, a leading @ ignored
    expect(await history.getGifters({ query: " @BETO " })).toEqual([
      expect.objectContaining({ userId: "b", rank: 2 }),
    ]);
    // Names too ("caro name"), and within a range
    expect(await history.getGifters({ from: 3000, query: "o na" })).toEqual([
      expect.objectContaining({ userId: "c", rank: 1 }),
    ]);
    expect(await history.getGifters({ query: "nobody" })).toEqual([]);
  });

  it("gives null for dates still read when another profile loads", async () => {
    const history = await loaded();
    history.start("kai", 10 * MINUTE);
    gifts(history, [10 * MINUTE + 1000, gift(viewer("1"), 5)]);
    history.end(12 * MINUTE);
    history.start("kai", 20 * MINUTE);
    history.end(21 * MINUTE);
    await history.save();

    // Both cut or leave out a LIVE, so they read its file
    const range = { from: 11 * MINUTE };
    const totals = history.getTotals(range);
    const gifters = history.getGifters(range);
    await history.load("b.json");

    expect(await totals).toBeNull();
    expect(await gifters).toBeNull();
    // Nothing loaded still gives a reply
    expect(await service().getTotals(range)).toEqual({
      coins: 0,
      gifts: 0,
      platforms: {},
    });
    expect(await service().getGifters(range)).toEqual([]);
  });

  it("stops reading dates when their signal aborts", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    history.end(2000);
    history.start("kai", 3000);
    history.end(4000);
    history.start("kai", 6000);
    history.end(7000);
    await history.save();
    const loadFile = vi.spyOn(json, "loadFile");

    // Leaves the last LIVE out, so it reads the other two's files
    const controller = new AbortController();
    const gifters = history.getGifters({ to: 5000, signal: controller.signal });
    controller.abort();

    expect(await gifters).toBeNull();
    expect(loadFile).toHaveBeenCalledOnce();
    expect(await history.getGifters({ to: 5000 })).toEqual([]);
  });

  it("reads a LIVE that just ended once its save is written", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    history.end(2000);
    history.start("kai", 3000);
    gifts(history, [3100, gift(viewer("a"), 100)]);
    // The periodic save's copy, without the gift after it
    await history.save();
    gifts(history, [3200, gift(viewer("a"), 50)]);
    history.end(4000);

    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const original = json.saveArbitraryFile.bind(json);
    vi.spyOn(json, "saveArbitraryFile").mockImplementation(
      async (file, data) => {
        if (file.endsWith("3000.json")) await gate;
        return original(file, data);
      },
    );
    const loadFile = vi.spyOn(json, "loadFile");
    const saved = history.save();
    // Asked while the write waits: awaited first, they'd never end
    const gifters = history.getGifters({ from: 3000 });
    const live = history.getLive(3000);
    // Any read that didn't wait finishes before the write
    await Promise.all(loadFile.mock.results.map((r) => r.value));
    open();

    expect(await saved).toBe(true);
    expect(await gifters).toEqual([
      expect.objectContaining({ userId: "a", coins: 150, rank: 1 }),
    ]);
    expect(await live).toEqual(
      expect.objectContaining({
        endedAt: 4000,
        gifters: [expect.objectContaining({ userId: "a", coins: 150 })],
      }),
    );
  });

  describe(`past ${MAX_LIVES} LIVEs`, () => {
    const HOUR = 3_600_000;
    const ana = {
      userId: "a",
      username: "Ana",
      handle: "ana",
      picture: "",
      coins: 150,
      gifts: 2,
      giftedAt: 1,
    };
    // LIVEs an hour apart, the oldest with 100 of Ana's coins in its file
    const seed = async (count: number) => {
      const lives = Array.from({ length: count }, (_, i) => ({
        username: "kai",
        startedAt: (i + 1) * HOUR,
        endedAt: (i + 1) * HOUR + 60_000,
        coins: 0,
        gifts: 0,
      }));
      await mkdir(join(dir, "a"));
      await writeFile(
        join(dir, "a", "index.json"),
        JSON.stringify({ lives, gifters: [ana] }),
      );
      await writeFile(
        join(dir, "a", `${HOUR}.json`),
        JSON.stringify({
          ...lives[0],
          gifters: [{ ...ana, coins: 100, gifts: 1 }],
        }),
      );
      return lives;
    };

    it("drops the oldest when a new one ends, as a delete would", async () => {
      const lives = await seed(MAX_LIVES);
      const history = await loaded();
      expect(history.getHistory().lives).toHaveLength(MAX_LIVES);

      history.start("kai", (MAX_LIVES + 1) * HOUR);
      history.end((MAX_LIVES + 1) * HOUR + 60_000);

      await vi.waitFor(() =>
        expect(history.getHistory().lives).toHaveLength(MAX_LIVES),
      );
      expect(history.getHistory().lives.at(-1)?.startedAt).toBe(
        lives[1].startedAt,
      );
      expect(history.getHistory().gifters).toEqual([
        expect.objectContaining({ userId: "a", coins: 50, gifts: 1 }),
      ]);
      await vi.waitFor(() =>
        expect(existsSync(join(dir, "a", `${HOUR}.json`))).toBe(false),
      );
    });

    it("saves the drop's index after the end's", async () => {
      const lives = await seed(MAX_LIVES);
      const history = await loaded();
      const startedAt = (MAX_LIVES + 1) * HOUR;
      // The new LIVE's file waits, so the drop's index could pass the end's
      let open = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      const original = json.saveArbitraryFile.bind(json);
      const saveFile = vi
        .spyOn(json, "saveArbitraryFile")
        .mockImplementation(async (file, data) => {
          if (file.endsWith(`${startedAt}.json`)) await gate;
          return original(file, data);
        });

      history.start("kai", startedAt);
      history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
      history.end(startedAt + 60_000);
      void history.save();
      await vi.waitFor(() =>
        expect(history.getHistory().lives).toHaveLength(MAX_LIVES),
      );
      open();
      const indexes = () =>
        saveFile.mock.calls.filter(([file]) => file.endsWith("index.json"));
      await vi.waitFor(() => expect(indexes()).toHaveLength(2));
      await Promise.all(saveFile.mock.results.map((r) => r.value));

      const saved = await read<{ lives: LiveSummary[] }>("index.json");
      expect(saved.lives).toHaveLength(MAX_LIVES);
      expect(saved.lives[0].startedAt).toBe(lives[1].startedAt);
    });

    it("drops the oldest when a history loads with more", async () => {
      const lives = await seed(MAX_LIVES + 2);
      const history = await loaded();

      expect(history.getHistory().lives).toHaveLength(MAX_LIVES);
      expect(history.getHistory().lives.at(-1)?.startedAt).toBe(
        lives[2].startedAt,
      );
      expect(
        (await read<{ lives: unknown[] }>("index.json")).lives,
      ).toHaveLength(MAX_LIVES);
    });
  });

  describe("deleting a LIVE", () => {
    const twoLives = async () => {
      const history = await loaded();
      history.start("kai", 1000);
      gifts(
        history,
        [1100, gift(viewer("a"), 100)],
        [1200, gift(viewer("b"), 20)],
      );
      history.end(2000);
      history.start("kai", 3000);
      gifts(history, [3100, gift(viewer("a"), 50)]);
      history.end(4000);
      await history.save();
      return history;
    };

    it("subtracts its gifters from all time and removes its file", async () => {
      const history = await twoLives();

      expect(await history.deleteLive(1000)).toBe(true);
      expect(history.getHistory()).toEqual({
        lives: [expect.objectContaining({ startedAt: 3000 })],
        gifters: [
          expect.objectContaining({ userId: "a", coins: 50, gifts: 1 }),
        ],
      });
      expect(existsSync(join(dir, "a", "1000.json"))).toBe(false);
      expect(await read<unknown>("index.json")).toEqual({
        lives: history.getHistory().lives,
        gifters: history.getHistory().gifters,
        newest: 3000,
      });
      expect(await history.getLive(1000)).toBeNull();
      expect(await history.getLive(3000)).toEqual(
        expect.objectContaining({ coins: 50 }),
      );
      expect(await history.deleteLive(1000)).toBe(true);
    });

    it("subtracts it once when two deletes run at once", async () => {
      const history = await twoLives();

      expect(
        await Promise.all([history.deleteLive(1000), history.deleteLive(1000)]),
      ).toEqual([true, true]);
      expect(history.getHistory().gifters).toEqual([
        expect.objectContaining({ userId: "a", coins: 50, gifts: 1 }),
      ]);
    });

    it("keeps its file until the index is saved", async () => {
      const history = await twoLives();
      vi.spyOn(json, "saveFile").mockResolvedValueOnce(false);

      // The newest: a load would take its file back as a crash's leftover
      expect(await history.deleteLive(3000)).toBe(false);
      expect(existsSync(join(dir, "a", "3000.json"))).toBe(true);

      // The retry saves the index, then the file goes
      expect(await history.save()).toBe(true);
      expect(existsSync(join(dir, "a", "3000.json"))).toBe(false);
      expect((await loaded()).getHistory().lives).toEqual([
        expect.objectContaining({ startedAt: 1000 }),
      ]);
    });

    it("removes its file on the next save when it can't at once", async () => {
      const history = await twoLives();
      vi.mocked(rm).mockRejectedValueOnce(new Error("EBUSY"));

      expect(await history.deleteLive(3000)).toBe(true);
      expect(existsSync(join(dir, "a", "3000.json"))).toBe(true);

      expect(await history.save()).toBe(true);
      expect(existsSync(join(dir, "a", "3000.json"))).toBe(false);
      expect((await loaded()).getHistory().lives).toEqual([
        expect.objectContaining({ startedAt: 1000 }),
      ]);
    });

    it("doesn't take the newest back on a load when a quit left its file", async () => {
      const history = await twoLives();
      vi.mocked(rm).mockRejectedValueOnce(new Error("EBUSY"));

      expect(await history.deleteLive(3000)).toBe(true);
      expect(existsSync(join(dir, "a", "3000.json"))).toBe(true);

      // No save before the quit
      expect((await loaded()).getHistory().lives).toEqual([
        expect.objectContaining({ startedAt: 1000 }),
      ]);
      expect(existsSync(join(dir, "a", "3000.json"))).toBe(false);
    });

    it("keeps a gifter the cap dropped and a later gift brought back", async () => {
      const history = await loaded();
      history.start("kai", 1000);
      for (let i = 0; i < MAX_GIFTERS; i++)
        gifts(history, [1100, gift(viewer(String(i)), 5)]);
      history.end(2000);
      // The fewest coins, so the cap drops x
      history.start("kai", 3000);
      gifts(history, [3100, gift(viewer("x"), 3)]);
      history.end(4000);
      expect(await history.deleteLive(1000)).toBe(true);
      history.start("kai", 5000);
      gifts(history, [5100, gift(viewer("x"), 1)]);
      history.end(6000);

      // x's all time holds only the last LIVE's gift
      expect(await history.deleteLive(3000)).toBe(true);
      expect(history.getHistory().gifters).toEqual([
        expect.objectContaining({ userId: "x", coins: 1, gifts: 1 }),
      ]);
    });

    it("leaves the index when its file doesn't load, keeping all time's gifts", async () => {
      const history = await twoLives();
      await writeFile(join(dir, "a", "1000.json"), "{ broken");
      const warn = vi.spyOn(Logger, "warn");

      expect(await history.deleteLive(1000)).toBe(true);
      expect(history.getHistory().lives).toEqual([
        expect.objectContaining({ startedAt: 3000 }),
      ]);
      expect(history.getHistory().gifters.map((g) => g.coins)).toEqual([
        150, 20,
      ]);
      expect(warn).toHaveBeenCalledWith(
        `<History> Deleting LIVE ${join(dir, "a", "1000.json")}, all time keeps its gifts`,
        undefined,
      );
    });
  });

  it("clears the history, keeping the LIVE in progress", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    gifts(history, [1100, gift(viewer("a"), 100)]);
    history.end(2000);
    history.start("kai", 3000);
    gifts(history, [3100, gift(viewer("b"), 5)]);
    await history.save();

    expect(await history.clear()).toBe(true);
    expect(history.getHistory()).toEqual({ lives: [], gifters: [] });
    expect(history.top().allTime.map((g) => g.userId)).toEqual(["b"]);
    expect(await readdir(dir)).toEqual(["a"]);
    expect(await readdir(join(dir, "a"))).toEqual(["3000.json", "index.json"]);
    // Empty, over anything a save racing the move wrote there
    expect(await read("index.json")).toEqual({ lives: [], gifters: [] });
  });

  it("removes a folder a clear left on the next load", async () => {
    await mkdir(join(dir, "a.cleared-123"));
    await writeFile(join(dir, "a.cleared-123", "index.json"), "{}");
    await mkdir(join(dir, "b.cleared-123"));
    await loaded();

    expect(await readdir(dir)).toEqual(["b.cleared-123"]);
  });

  describe("each platform's money and gifted subs", () => {
    // Rates that load when the test says, 20 pesos to the dollar
    const rates = () => {
      let loaded = false;
      const listeners: (() => void)[] = [];
      return {
        toUsd: (amounts: Readonly<Record<string, number>>) =>
          loaded ? (amounts.MXN ?? 0) / 20 + (amounts.USD ?? 0) : null,
        onChange: (listener: () => void) => void listeners.push(listener),
        load: () => {
          loaded = true;
          for (const listener of listeners) listener();
        },
      };
    };

    it("keeps each platform's part of the LIVE, one record per viewer on each", async () => {
      const history = await loaded();
      history.start("kai", 0);
      history.join("tiktok");
      // On the LIVE, though it sends nothing
      history.join("youtube");
      vi.setSystemTime(1);
      history.record(TOKIO_EVENTS.CHEER, {
        user: twitcher("twitch:1"),
        bits: 100,
        message: "",
      });
      history.record(TOKIO_EVENTS.GIFT_SUB, {
        user: twitcher("twitch:1"),
        count: 5,
        tier: "1000",
      });
      history.record(TOKIO_EVENTS.GIFT_SUB, {
        user: kicker("kick:2"),
        count: 2,
        tier: "",
      });
      gifts(history, [2, gift(kicker("kick:2"), 50)]);
      history.end(10);
      await history.save();

      const [live] = history.getHistory().lives;
      expect(live).toMatchObject({ coins: 0, gifts: 1 });
      expect(live.platforms).toEqual({
        tiktok: { amount: 0, gifts: 0, giftSubs: 0 },
        youtube: { amount: 0, gifts: 0, giftSubs: 0 },
        twitch: { amount: 100, gifts: 0, giftSubs: 5 },
        kick: { amount: 50, gifts: 1, giftSubs: 2 },
      });
      expect(history.getHistory().gifters).toEqual([
        expect.objectContaining({
          userId: "twitch:1",
          coins: 100,
          gifts: 0,
          giftSubs: 5,
          platform: "twitch",
        }),
        expect.objectContaining({
          userId: "kick:2",
          coins: 50,
          gifts: 1,
          giftSubs: 2,
          platform: "kick",
        }),
      ]);
      expect((await read<LiveRecord>("0.json")).minutes).toEqual([
        {
          minute: 0,
          gifters: { "twitch:1": [100, 0, 5], "kick:2": [50, 1, 2] },
        },
      ]);
    });

    it("counts gifted subs without an id in the LIVE only, in their platform's", async () => {
      const history = await loaded();
      history.start("kai", 0);
      vi.setSystemTime(1);
      for (const user of [kicker(""), twitcher(""), tuber("")]) {
        history.record(TOKIO_EVENTS.GIFT_SUB, { user, count: 3, tier: "" });
      }
      history.end(10);
      await history.save();

      expect(history.getHistory()).toMatchObject({
        lives: [
          {
            platforms: {
              kick: { giftSubs: 3 },
              twitch: { giftSubs: 3 },
              youtube: { giftSubs: 3 },
            },
          },
        ],
        gifters: [],
      });
      expect((await read<LiveRecord>("0.json")).minutes).toEqual([
        {
          minute: 0,
          gifters: {
            "kick:": [0, 0, 3],
            "twitch:": [0, 0, 3],
            "youtube:": [0, 0, 3],
          },
        },
      ]);
    });

    it("counts a Super Chat's dollars, and a YouTube Gift on a record the viewer has", async () => {
      const history = await loaded();
      history.start("kai", 0);
      const yui = tuber("youtube:UC1");
      // No record yet: the LIVE only
      gifts(history, [1, gift(yui, 0)]);
      history.record(TOKIO_EVENTS.SUPER_CHAT, superChat(yui, "$5.00", 5));
      gifts(history, [2, gift(yui, 0)]);
      history.end(10);

      expect(history.getHistory()).toMatchObject({
        lives: [{ platforms: { youtube: { amount: 5, gifts: 2 } } }],
        gifters: [{ userId: "youtube:UC1", coins: 5, gifts: 1 }],
      });
    });

    it("counts a Super Chat that came before the rates once they load, in its minute", async () => {
      const history = await loaded();
      const r = rates();
      history.setRates(r);
      history.start("kai", 0);
      const yui = tuber("youtube:UC1");
      vi.setSystemTime(1000);
      history.record(
        TOKIO_EVENTS.SUPER_CHAT,
        superChat(yui, "MX$100.00", null),
      );
      expect(history.topByPlatform()).toEqual({});

      vi.setSystemTime(2 * MINUTE);
      history.record(TOKIO_EVENTS.SUPER_CHAT, superChat(yui, "$1.00", 1));
      r.load();
      history.end(3 * MINUTE);
      await history.save();

      expect(history.getHistory()).toMatchObject({
        lives: [{ platforms: { youtube: { amount: 6 } } }],
        gifters: [{ userId: "youtube:UC1", coins: 6, giftedAt: 2 * MINUTE }],
      });
      expect((await read<LiveRecord>("0.json")).minutes).toEqual([
        { minute: 0, gifters: { "youtube:UC1": [5, 0, 0] } },
        { minute: 2, gifters: { "youtube:UC1": [1, 0, 0] } },
      ]);
    });

    it("leaves out a Super Chat whose rates didn't load before the LIVE ended, and one it can't read", async () => {
      const warn = vi.spyOn(Logger, "warn");
      const history = await loaded();
      const r = rates();
      history.setRates(r);
      history.start("kai", 0);
      history.join("youtube");
      const yui = tuber("youtube:UC1");
      history.record(TOKIO_EVENTS.SUPER_CHAT, superChat(yui, "MX$100.00"));
      history.record(TOKIO_EVENTS.SUPER_CHAT, superChat(yui, "100 bananas"));
      history.record(TOKIO_EVENTS.SUPER_CHAT, superChat(yui, "100 bananas"));
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenLastCalledWith(
        `<History> Couldn't read the Super Chat amount "100 bananas", left out of the LIVE's dollars`,
        undefined,
      );
      history.end(10);
      r.load();

      expect(warn).toHaveBeenLastCalledWith(
        "<History> Left 1 Super Chat(s) out of the LIVE's dollars, the exchange rates didn't load before it ended",
        undefined,
      );
      expect(history.getHistory()).toMatchObject({
        lives: [{ platforms: { youtube: { amount: 0 } } }],
        gifters: [],
      });
    });

    it("ranks each platform by its amount, then gifted subs, then the earliest", async () => {
      const history = await loaded();
      history.start("kai", 0);
      const cheer = (user: UserData, bits: number) =>
        history.record(TOKIO_EVENTS.CHEER, { user, bits, message: "" });
      const subs = (user: UserData, count: number) =>
        history.record(TOKIO_EVENTS.GIFT_SUB, { user, count, tier: "" });
      vi.setSystemTime(1);
      cheer(twitcher("twitch:a"), 100);
      vi.setSystemTime(2);
      cheer(twitcher("twitch:b"), 100);
      subs(twitcher("twitch:b"), 1);
      vi.setSystemTime(3);
      subs(twitcher("twitch:c"), 10);
      gifts(history, [4, gift(viewer("t"), 1)]);

      const ids = (list: { userId: string }[] | undefined) =>
        list?.map((g) => g.userId);
      expect(ids(history.topByPlatform().twitch)).toEqual([
        "twitch:b",
        "twitch:a",
        "twitch:c",
      ]);
      history.end(10);
      expect(
        (await history.getGifters({}))?.map((g) => [g.userId, g.rank]),
      ).toEqual([
        ["twitch:b", 1],
        ["twitch:a", 2],
        ["t", 1],
        ["twitch:c", 3],
      ]);
      expect(
        (await history.getGifters({ from: 1 }))?.map((g) => g.userId),
      ).toEqual(["twitch:b", "twitch:a", "t", "twitch:c"]);
    });

    it(`keeps ${MAX_GIFTERS} of each platform's in all time`, async () => {
      const history = await loaded();
      history.start("kai", 0);
      for (let i = 0; i < MAX_GIFTERS; i++)
        gifts(history, [10, gift(viewer(String(i)), 5)]);
      // Twitch's have their own cap
      history.record(TOKIO_EVENTS.GIFT_SUB, {
        user: twitcher("twitch:1"),
        count: 1,
        tier: "",
      });
      gifts(history, [1, gift(viewer("old"), 1)]);
      history.end(100);

      const ids = history.getHistory().gifters.map((g) => g.userId);
      expect(ids).not.toContain("old");
      expect(ids).toContain("twitch:1");
    });

    it("gives overlays TikTok's and Kick's gift gifters only, as before", async () => {
      const history = await loaded();
      history.start("kai", 0);
      gifts(history, [1, gift(kicker("kick:1"), 5)], [2, gift(viewer("1"), 9)]);
      history.record(TOKIO_EVENTS.CHEER, {
        user: twitcher("twitch:1"),
        bits: 500,
        message: "",
      });
      history.record(TOKIO_EVENTS.GIFT_SUB, {
        user: kicker("kick:2"),
        count: 9,
        tier: "",
      });
      history.record(
        TOKIO_EVENTS.SUPER_CHAT,
        superChat(tuber("youtube:1"), "$50.00", 50),
      );

      const ids = () => {
        const { live, allTime } = history.top();
        return [live, allTime].map((list) => list.map((g) => g.userId));
      };
      expect(ids()).toEqual([
        ["1", "kick:1"],
        ["1", "kick:1"],
      ]);
      history.end(10);
      expect(ids()).toEqual([[], ["1", "kick:1"]]);
      expect(Object.keys(history.topByPlatform())).toEqual([]);
    });

    it("reads an older LIVE as TikTok's, two-number minutes with no gifted subs", async () => {
      await mkdir(join(dir, "a"), { recursive: true });
      const live = {
        username: "kai",
        startedAt: 0,
        endedAt: 2 * MINUTE,
        coins: 7,
        gifts: 2,
      };
      const gifter = {
        userId: "1",
        username: "ana",
        handle: "ana",
        picture: "",
        coins: 7,
        gifts: 2,
        giftedAt: MINUTE,
      };
      await writeFile(
        join(dir, "a", "index.json"),
        JSON.stringify({ lives: [live], gifters: [gifter], newest: 0 }),
      );
      await writeFile(
        join(dir, "a", "0.json"),
        JSON.stringify({
          ...live,
          gifters: [gifter],
          minutes: [
            { minute: 0, gifters: { 1: [5, 1] } },
            { minute: 1, gifters: { 1: [2, 1] } },
          ],
        }),
      );

      const history = await loaded();

      expect((await history.getLive(0))?.minutes).toEqual([
        { minute: 0, gifters: { 1: [5, 1, 0] } },
        { minute: 1, gifters: { 1: [2, 1, 0] } },
      ]);
      expect(await history.getTotals({})).toMatchObject({
        platforms: { tiktok: { amount: 7, gifts: 2, giftSubs: 0 } },
      });
      expect(await history.getTotals({ from: MINUTE })).toEqual({
        coins: 2,
        gifts: 1,
        platforms: { tiktok: { amount: 2, gifts: 1, giftSubs: 0 } },
      });
      expect(await history.getGifters({ from: MINUTE })).toEqual([
        expect.objectContaining({ userId: "1", coins: 2, giftSubs: 0 }),
      ]);
    });

    it("keeps a platform a cut LIVE was on in the dates' totals, with zeros", async () => {
      const history = await loaded();
      history.start("kai", 0);
      history.join("twitch");
      gifts(history, [1000, gift(viewer("1"), 5)]);
      history.end(2 * MINUTE);

      expect((await history.getTotals({ from: MINUTE }))?.platforms).toEqual({
        tiktok: { amount: 0, gifts: 0, giftSubs: 0 },
        twitch: { amount: 0, gifts: 0, giftSubs: 0 },
      });
    });

    it("subtracts a deleted LIVE's gifted subs from all time", async () => {
      const history = await loaded();
      const subs = (count: number) =>
        history.record(TOKIO_EVENTS.GIFT_SUB, {
          user: twitcher("twitch:1"),
          count,
          tier: "",
        });
      history.start("kai", 0);
      subs(2);
      history.end(10);
      history.start("kai", 20);
      subs(3);
      history.end(30);
      await history.deleteLive(0);
      expect(history.getHistory().gifters).toEqual([
        expect.objectContaining({ userId: "twitch:1", giftSubs: 3 }),
      ]);
      await history.deleteLive(20);
      expect(history.getHistory().gifters).toEqual([]);
    });
  });

  it("tells its listeners when the overlays' lists may change", async () => {
    const history = await loaded();
    const listener = vi.fn();
    history.onChange(listener);
    history.start("kai", 1000);
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5, 1, false));
    // A combo's end that adds nothing
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5, 1, true));
    expect(listener).toHaveBeenCalledTimes(2);

    history.end(2000);
    await history.deleteLive(1000);
    await history.clear();
    await history.load("b.json");
    expect(listener).toHaveBeenCalledTimes(6);
  });
});
