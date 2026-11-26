import { ProfileSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { AppFailure } from "@/helper/feedback";
import { createHandler } from "@test/handler";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  checkPath,
  FLUSH_MS,
  flushWindow,
  guardProfile,
  invokeOk,
  pushProfile,
  pushSettings,
  settingsFlushed,
  unknownKeys,
  write,
} from "./common";

describe("flushWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the window to flush and waits for its answer", async () => {
    const h = createHandler();
    let done = false;

    const flushed = flushWindow(h.handler).then(() => (done = true));
    const [{ id }] = h.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS);
    await Promise.resolve();
    expect(done).toBe(false);
    settingsFlushed("another");
    await Promise.resolve();
    expect(done).toBe(false);

    settingsFlushed(id);
    await flushed;
    expect(done).toBe(true);
  });

  it("stops waiting after FLUSH_MS", async () => {
    vi.useFakeTimers();
    const h = createHandler();
    let done = false;

    const flushed = flushWindow(h.handler).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(FLUSH_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await flushed;
    expect(done).toBe(true);
  });

  it("doesn't wait for a window that's gone or closes", async () => {
    const closed = createHandler();
    closed.win.close();
    await flushWindow(closed.handler);
    expect(closed.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS)).toEqual([]);

    const closing = createHandler();
    const flushed = flushWindow(closing.handler);
    closing.win.close();
    await flushed;
  });
});

describe("write", () => {
  it("runs the writes one at a time, each after a flush", async () => {
    const h = createHandler();
    const order: string[] = [];
    const answer = () => {
      const pushes = h.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS);
      settingsFlushed(pushes.at(-1)!.id);
    };
    let release!: () => void;
    const first = write(h.handler, async () => {
      order.push("first");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first done");
      throw new Error("failed");
    });
    const second = write(h.handler, () => {
      order.push("second");
      return 2;
    });

    await vi.waitFor(() =>
      expect(h.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS)).toHaveLength(1),
    );
    answer();
    await vi.waitFor(() => expect(order).toEqual(["first"]));
    release();
    await expect(first).rejects.toThrow("failed");
    await vi.waitFor(() =>
      expect(h.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS)).toHaveLength(2),
    );
    expect(order).toEqual(["first", "first done"]);
    answer();

    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first", "first done", "second"]);
  });
});

describe("guardProfile", () => {
  it("refuses once another profile is active", () => {
    const settings = { activeProfile: { file: "a.json", name: "A" } };
    const h = createHandler({
      storeManagerService: { getSettings: () => settings },
    });

    const changed = guardProfile(h.handler);
    expect(changed()).toBeUndefined();
    settings.activeProfile = { file: "b.json", name: "B" };

    expect(changed()).toMatchObject({ isError: true });
  });
});

describe("pushes", () => {
  it("sends the active profile and the settings", async () => {
    const profile = { name: "A" };
    const profiles = [{ name: "A", file: "a.json" }];
    const getProfileData = vi.fn(async () => profile);
    const h = createHandler({
      storeManagerService: {
        getProfileData,
        getProfiles: () => profiles,
        getSettings: () => ({ language: "en", activeProfile: profiles[0] }),
      },
    });

    await pushProfile(h.handler);
    pushSettings(h.handler);

    expect(getProfileData).toHaveBeenCalledWith({ fresh: true });
    expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([
      { success: true, profile, profiles, file: "a.json" },
    ]);
    expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
      {
        success: true,
        data: {
          settings: { language: "en", activeProfile: profiles[0] },
          profiles,
        },
      },
    ]);
  });
});

describe("unknownKeys", () => {
  const schema = z
    .object({
      speed: z.number(),
      voice: z
        .object({ id: z.string(), pitch: z.number().default(1) })
        .strict(),
      filters: z.object({ volume: z.number() }).optional(),
      list: z.array(z.object({ a: z.number() })),
      byId: z.record(z.string(), z.object({ on: z.boolean() })),
      loose: z.object({}).loose(),
      trigger: z.union([
        z.object({ type: z.literal("gift"), gift: z.string() }),
        z.object({ type: z.literal("follow") }),
      ]),
      wrapped: z.preprocess((v) => v, z.object({ x: z.number() })),
    })
    .strict();

  it("names the paths the schema hasn't", () => {
    expect(
      unknownKeys(schema, {
        speed: 1,
        sped: 2,
        voice: { pitch: 2, pich: 1 },
        filters: { volume: 1, gain: 1 },
        list: [{ b: 1 }],
        byId: { x: { on: true, of: false } },
        loose: { anything: 1 },
        trigger: { type: "gift", gift: "Rose", extra: 1 },
        wrapped: { x: 1, y: 2 },
        __proto__: { polluted: true },
      }),
    ).toEqual([
      "sped",
      "voice.pich",
      "filters.gain",
      "byId.x.of",
      "trigger.extra",
      "wrapped.y",
    ]);
  });

  it("names an own __proto__ key from JSON", () => {
    expect(unknownKeys(schema, JSON.parse('{"__proto__": {"a": 1}}'))).toEqual([
      "__proto__",
    ]);
  });

  it("names a record's key outside its enum, which the schema would drop", () => {
    const changes = {
      tts: {
        permissions: {
          platforms: {
            twich: { all: false },
            tiktok: {},
            kick: { vips: true },
          },
        },
      },
    };

    expect(unknownKeys(ProfileSchema, changes)).toEqual([
      "tts.permissions.platforms.twich",
      "tts.permissions.platforms.tiktok",
    ]);
  });

  it("finds none in known keys or a value of the wrong type", () => {
    expect(unknownKeys(schema, { speed: "fast", voice: 3 })).toEqual([]);
  });
});

describe("checkPath", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-mcp-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("takes a local file", async () => {
    const file = join(dir, "a.mp3");
    await writeFile(file, "x");

    expect(await checkPath(file)).toBeUndefined();
  });

  it.each([
    ["a UNC path", "\\\\server\\share\\a.mp3"],
    ["a UNC path with slashes", "//server/share/a.mp3"],
    ["a device path", "\\\\?\\C:\\a.mp3"],
    ["a mixed UNC path", "/\\server\\a.mp3"],
    ["a relative path", "a.mp3"],
  ])("refuses %s", async (_name, path) => {
    expect(await checkPath(path)).toMatchObject({ isError: true });
  });

  it("refuses a folder and a missing file", async () => {
    expect(await checkPath(dir)).toMatchObject({ isError: true });
    expect(await checkPath(join(dir, "none.mp3"))).toMatchObject({
      isError: true,
    });
  });
});

describe("invokeOk", () => {
  const stack = () => {
    const events = createStack("system");
    events.push(APP_EVENTS.CONTROL, (_h, e, { action }) => {
      if (action === "pause") {
        e.reply(APP_EVENTS_RESPONSE.CONTROL, {
          success: false,
          error: { code: FEEDBACK_CODES.CONTROL_FAILED, message: "No way." },
          action,
          done: false,
          paused: false,
        });
        return;
      }
      e.reply(APP_EVENTS_RESPONSE.CONTROL, {
        success: true,
        action,
        done: true,
        paused: false,
      });
    });
    // Fails only through its notice, as ACTIVE_FEATURES does
    events.push(APP_EVENTS.ACTIVE_FEATURES, () => {
      throw new AppFailure(FEEDBACK_CODES.FEATURES_UPDATE_FAILED, "Not saved.");
    });
    return events;
  };

  it("gives the reply", async () => {
    const h = createHandler({}, { stack: stack() });

    const res = await invokeOk(
      h.handler,
      APP_EVENTS.CONTROL,
      { action: "stopTts" },
      APP_EVENTS_RESPONSE.CONTROL,
    );

    expect(res).toEqual({
      data: { success: true, action: "stopTts", done: true, paused: false },
    });
  });

  it("turns a failure reply into an error result", async () => {
    const h = createHandler({}, { stack: stack() });

    const { error } = await invokeOk(
      h.handler,
      APP_EVENTS.CONTROL,
      { action: "pause" },
      APP_EVENTS_RESPONSE.CONTROL,
    );

    expect(error).toEqual({
      content: [{ type: "text", text: "No way." }],
      isError: true,
    });
  });

  it("turns a handler that only notifies into an error result", async () => {
    const h = createHandler({}, { stack: stack() });

    const { error } = await invokeOk(h.handler, APP_EVENTS.ACTIVE_FEATURES, {
      tts: false,
    });

    expect(error).toMatchObject({
      content: [{ type: "text", text: "Not saved." }],
      isError: true,
    });
  });

  it("fails when the reply never came", async () => {
    const h = createHandler({}, { stack: stack() });

    const { error } = await invokeOk(
      h.handler,
      APP_EVENTS.CONTROL,
      { action: "stopTts" },
      APP_EVENTS_RESPONSE.GET_SETTINGS,
    );

    expect(error).toMatchObject({
      content: [
        { type: "text", text: `Tokio didn't answer ${APP_EVENTS.CONTROL}.` },
      ],
      isError: true,
    });
  });
});
