import { Fan, TOKIO_EVENTS, UserData } from "@/common/types";
import Logger from "@/logger";
import { JSONManagerService } from "@/services/json";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FansService, MAX_FANS, SENT_FANS } from "./index";

const viewer = (userId: string, fanLevel = 5, handle = `fan${userId}`) =>
  ({
    userId,
    username: `${handle} name`,
    handle,
    profilePictures: [`https://p16/${handle}.jpg`, `https://p19/${handle}.jpg`],
    fanLevel,
    fanBadge: `https://p16/lv${fanLevel}.png`,
  }) satisfies UserData;

describe("FansService", () => {
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
    const fans = new FansService();
    fans.initialize({ json, folder: dir });
    return fans;
  };

  const loaded = async (file = "a.json") => {
    const fans = service();
    await fans.load(file);
    return fans;
  };

  const saved = async (file = "a.json"): Promise<Fan[]> =>
    JSON.parse(await readFile(join(dir, file), "utf-8")).fans;

  it("keeps a fan by id, as they showed last", async () => {
    const fans = await loaded();
    vi.setSystemTime(1000);
    fans.record(viewer("1", 5, "ana"));
    vi.setSystemTime(2000);
    fans.record({ ...viewer("1", 7, "ana_2"), username: "Ana" });

    expect(fans.list()).toEqual([
      {
        userId: "1",
        username: "Ana",
        handle: "ana_2",
        fanLevel: 7,
        fanBadge: "https://p16/lv7.png",
        superfan: false,
        seenAt: 2000,
      },
    ]);
  });

  it("keeps whether a fan is a Super Fan, as the events that carry it say", async () => {
    const fans = await loaded();
    const superfan = () => fans.list()[0].superfan;

    fans.record({ ...viewer("1"), superfan: true }, TOKIO_EVENTS.CHAT);
    expect(superfan()).toBe(true);
    // Likes carry no Super Fan flag: the connector says false
    fans.record({ ...viewer("1"), superfan: false }, TOKIO_EVENTS.LIKE);
    expect(superfan()).toBe(true);
    // A gift says they no longer are
    fans.record({ ...viewer("1"), superfan: false }, TOKIO_EVENTS.GIFT);
    expect(superfan()).toBe(false);
    // Becoming one, or joining as one, says they are, whatever the flag
    fans.record({ ...viewer("1"), superfan: false }, TOKIO_EVENTS.SUPER_FAN);
    expect(superfan()).toBe(true);
    fans.record(
      { ...viewer("2"), superfan: false },
      TOKIO_EVENTS.SUPER_FAN_JOIN,
    );
    expect(fans.list().find((f) => f.userId === "2")?.superfan).toBe(true);
  });

  it("loads a fan saved without a badge picture or Super Fan status", async () => {
    const fan = { userId: "1", username: "Ana", handle: "ana", fanLevel: 3 };
    await writeFile(
      join(dir, "a.json"),
      JSON.stringify({ fans: [{ ...fan, seenAt: 1 }] }),
    );

    expect((await loaded()).list()).toEqual([
      { ...fan, fanBadge: "", superfan: false, seenAt: 1 },
    ]);
  });

  it("leaves out viewers without a fan level or an id, and any before a load", async () => {
    const fans = service();
    fans.record(viewer("1"));
    await fans.load("a.json");
    fans.record(viewer("2", 0));
    fans.record({ ...viewer("3"), fanLevel: undefined });
    fans.record({ ...viewer("4"), userId: "" });
    fans.record({ ...viewer("5"), userId: undefined });

    expect(fans.list()).toEqual([]);
  });

  it("keeps a fan's level when a later event shows none", async () => {
    const fans = await loaded();
    fans.record(viewer("1", 9));
    fans.record(viewer("1", 0));

    expect(fans.list()).toEqual([
      expect.objectContaining({ userId: "1", fanLevel: 9 }),
    ]);
  });

  it("sends the highest levels first, then the most recently seen", async () => {
    const fans = await loaded();
    vi.setSystemTime(1);
    fans.record(viewer("a", 2));
    vi.setSystemTime(2);
    fans.record(viewer("b", 5));
    vi.setSystemTime(3);
    fans.record(viewer("c", 2));

    expect(fans.list().map((f) => f.userId)).toEqual(["b", "c", "a"]);
  });

  it(`sends at most ${SENT_FANS}`, async () => {
    const fans = await loaded();
    for (let i = 1; i <= SENT_FANS + 1; i++) fans.record(viewer(String(i), i));

    const ids = fans.list().map((f) => f.userId);
    expect(ids).toHaveLength(SENT_FANS);
    expect(ids).not.toContain("1");
  });

  it("lists them all for the Fans page, in the same order", async () => {
    const fans = await loaded();
    for (let i = 1; i <= SENT_FANS + 1; i++) fans.record(viewer(String(i), i));

    const ids = fans.list(MAX_FANS).map((f) => f.userId);
    expect(ids).toHaveLength(SENT_FANS + 1);
    expect(ids.slice(0, 2)).toEqual([String(SENT_FANS + 1), String(SENT_FANS)]);
  });

  it(`keeps ${MAX_FANS}, dropping the one not seen for the longest`, async () => {
    const fans = await loaded();
    for (let i = 0; i < MAX_FANS; i++) fans.record(viewer(String(i)));
    // Seen again, so 1 is now the one not seen for the longest
    fans.record(viewer("0"));
    fans.record(viewer("new"));
    await fans.save();

    const ids = (await saved()).map((f) => f.userId);
    expect(ids).toHaveLength(MAX_FANS);
    expect(ids).not.toContain("1");
    expect(ids.slice(-2)).toEqual(["0", "new"]);
  });

  it("saves the fans in their profile's file, and loads them back", async () => {
    const fans = service();
    expect(await fans.load("a.json")).toBe(true);
    expect(fans.list()).toEqual([]);
    vi.setSystemTime(1000);
    fans.record(viewer("1", 3, "ana"));

    expect(await fans.save()).toBe(true);
    const again = service();
    expect(await again.load("a.json")).toBe(true);
    expect(again.list()).toEqual(fans.list());
  });

  it("writes nothing when nothing changed", async () => {
    const fans = await loaded();

    expect(await fans.save()).toBe(true);
    expect(existsSync(join(dir, "a.json"))).toBe(false);
  });

  it.each([
    ["isn't JSON", "{ broken"],
    ["holds something else", '{ "fans": [{ "userId": 1 }] }'],
  ])(
    "leaves a file that %s as it is, and records nothing",
    async (_, content) => {
      const path = join(dir, "a.json");
      await writeFile(path, content);
      const warn = vi.spyOn(Logger, "warn");
      const fans = service();
      expect(await fans.load("a.json")).toBe(false);
      fans.record(viewer("1"));

      expect(fans.list()).toEqual([]);
      expect(await fans.save()).toBe(true);
      expect(await readFile(path, "utf-8")).toBe(content);
      expect(warn).toHaveBeenCalledWith(
        `<Fans> Not recording fans, ${path} didn't load`,
        undefined,
      );
    },
  );

  it("saves into the file the fans came from when another profile loads meanwhile", async () => {
    const fans = await loaded("a.json");
    fans.record(viewer("1"));
    const saving = fans.save();
    await fans.load("b.json");

    expect(await saving).toBe(true);
    expect((await saved("a.json")).map((f) => f.userId)).toEqual(["1"]);
    expect(fans.list()).toEqual([]);
    expect(existsSync(join(dir, "b.json"))).toBe(false);
  });

  it("keeps the latest load when an earlier one ends after it", async () => {
    const before = await loaded("a.json");
    before.record(viewer("1"));
    await before.save();

    const fans = service();
    const first = fans.load("a.json");
    await fans.load("b.json");
    await first;

    expect(fans.list()).toEqual([]);
  });

  it("tries a failed save again on the next one", async () => {
    const fans = await loaded();
    const saveFile = vi.spyOn(json, "saveFile").mockResolvedValueOnce(false);
    fans.record(viewer("1"));

    expect(await fans.save()).toBe(false);
    expect(await fans.save()).toBe(true);
    expect(saveFile).toHaveBeenCalledTimes(2);
    expect((await saved()).map((f) => f.userId)).toEqual(["1"]);
  });

  it("tells its listeners when the fans change, and after each load", async () => {
    const fans = await loaded();
    const listener = vi.fn();
    fans.onChange(listener);
    fans.record(viewer("1"));
    fans.record(viewer("2", 0));
    await fans.load("b.json");

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
