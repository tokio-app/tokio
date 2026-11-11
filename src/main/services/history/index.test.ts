import {
  GiftEvent,
  LiveRecord,
  LiveSummary,
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

const viewer = (userId: string, handle = `fan${userId}`) =>
  ({
    userId,
    username: `${handle} name`,
    handle,
    profilePictures: [`https://p16/${handle}.jpg`, `https://p19/${handle}.jpg`],
  }) satisfies UserData;

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

  it(`keeps every gifter in a LIVE's file and ${MAX_GIFTERS} in all time`, async () => {
    const history = await loaded();
    history.start("kai", 0);
    for (let i = 0; i < MAX_GIFTERS - 1; i++)
      gifts(history, [10, gift(viewer(String(i)), 5)]);
    // The fewest coins, and the older one is dropped
    gifts(history, [1, gift(viewer("old"), 1)], [2, gift(viewer("new"), 1)]);
    history.end(100);
    expect(await history.save()).toBe(true);

    const record = await read<LiveRecord>("0.json");
    expect(record.gifters).toHaveLength(MAX_GIFTERS + 1);
    expect(record.endedAt).toBe(100);
    const index = await read<{
      lives: LiveSummary[];
      gifters: { userId: string }[];
    }>("index.json");
    const { gifters, minutes, ...summary } = record;
    expect(minutes).toEqual([expect.objectContaining({ minute: 0 })]);
    expect(index.lives).toEqual([summary]);
    const ids = index.gifters.map((g) => g.userId);
    expect(ids).toHaveLength(MAX_GIFTERS);
    expect(ids).not.toContain("old");
    expect(ids.at(-1)).toBe("new");
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
      const history = await loaded();
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
    // The LIVE's file fails, the index saves
    const saveFile = vi
      .spyOn(json, "saveArbitraryFile")
      .mockResolvedValueOnce(false);

    expect(await history.save()).toBe(false);
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
      { minute: 0, gifters: { 1: [10, 2] } },
      { minute: 1, gifters: { 2: [100, 1], "": [1, 1] } },
      { minute: 2, gifters: { 1: [2, 1] } },
    ]);
    const { lives } = await read<{ lives: LiveSummary[] }>("index.json");
    expect(lives).toEqual([
      {
        username: "kai",
        startedAt: start,
        endedAt: start + 120_000,
        coins: 113,
        gifts: 5,
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
      { minute: 0, gifters: { 1: [5, 1] } },
      { minute: 1, gifters: { 1: [5, 1] } },
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
    expect(await history.getTotals(since)).toEqual({ coins: 111, gifts: 4 });
    expect(await history.getGifters(since)).toEqual([
      expect.objectContaining({ userId: "2", coins: 101, gifts: 2, rank: 1 }),
      expect.objectContaining({ userId: "1", coins: 7, gifts: 1, rank: 2 }),
    ]);

    // The first LIVE's first minute
    const until = { to: 11 * MINUTE };
    expect(await history.getTotals(until)).toEqual({ coins: 5, gifts: 1 });
    expect(await history.getGifters(until)).toEqual([
      expect.objectContaining({ userId: "1", coins: 5, rank: 1 }),
    ]);

    // Both minutes the dates start and end in count
    const across = { from: 10 * MINUTE + 20_000, to: 11 * MINUTE + 20_000 };
    expect(await history.getTotals(across)).toEqual({ coins: 115, gifts: 4 });

    // Whole LIVEs come from the list, as do the dates of one LIVE
    expect(await history.getTotals({})).toEqual({ coins: 116, gifts: 5 });
    expect(
      await history.getGifters({ from: start, to: start + 120_000 }),
    ).toEqual([
      expect.objectContaining({ userId: "2", coins: 100, rank: 1 }),
      expect.objectContaining({ userId: "1", coins: 12, rank: 2 }),
    ]);
    expect(await history.getTotals({ from: 30 * MINUTE })).toEqual({
      coins: 0,
      gifts: 0,
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
    expect(await service().getTotals(range)).toEqual({ coins: 0, gifts: 0 });
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
