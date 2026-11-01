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
import { HistoryService, MAX_GIFTERS, TOP_GIFTERS } from "./index";

const viewer = (userId: string, handle = `fan${userId}`) =>
  ({
    userId,
    username: `${handle} name`,
    handle,
    profilePictures: [`https://p16/${handle}.jpg`, `https://p19/${handle}.jpg`],
  }) satisfies UserData;

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

  it("counts a LIVE's events, a combo once", async () => {
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
    history.record(TOKIO_EVENTS.FOLLOW, { user: ana });
    history.record(TOKIO_EVENTS.SHARE, { user: ana, shareCount: 1 });
    history.record(TOKIO_EVENTS.LIKE, {
      user: ana,
      likeCount: 5,
      totalLikes: 50,
    });
    history.record(TOKIO_EVENTS.LIKE, {
      user: ana,
      likeCount: 5,
      totalLikes: 40,
    });
    for (const [views, viewers] of [
      [100, 12],
      [90, 30],
      [120, 20],
    ])
      history.record(TOKIO_EVENTS.ROOM_USER, { ranks: [], views, viewers });
    history.end(2000);

    expect(history.getHistory()).toEqual({
      lives: [
        {
          username: "kai",
          startedAt: 1000,
          endedAt: 2000,
          coins: 115,
          gifts: 4,
          followers: 1,
          shares: 1,
          likes: 50,
          views: 120,
          peakViewers: 30,
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
    const { gifters, ...summary } = record;
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

  it("loads a saved history back, and writes nothing when unchanged", async () => {
    const empty = await loaded();
    expect(await empty.save()).toBe(true);
    expect(existsSync(join(dir, "a"))).toBe(false);

    const history = await loaded();
    history.start("kai", 1000);
    gifts(history, [1100, gift(viewer("1"), 5)], [1200, gift(viewer("2"), 9)]);
    history.end(2000);
    await history.save();

    const saveFile = vi.spyOn(json, "saveFile");
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

  it("tries a failed save again on the next one", async () => {
    const history = await loaded();
    history.start("kai", 1000);
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5));
    history.end(2000);
    // The LIVE's file fails, the index saves
    const saveFile = vi.spyOn(json, "saveFile").mockResolvedValueOnce(false);

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
    // A combo's end that adds nothing, and events that don't touch the lists
    history.record(TOKIO_EVENTS.GIFT, gift(viewer("1"), 5, 1, true));
    history.record(TOKIO_EVENTS.FOLLOW, { user: viewer("1") });
    expect(listener).toHaveBeenCalledTimes(2);

    history.end(2000);
    await history.deleteLive(1000);
    await history.clear();
    await history.load("b.json");
    expect(listener).toHaveBeenCalledTimes(6);
  });
});
