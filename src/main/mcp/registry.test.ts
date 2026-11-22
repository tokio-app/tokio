import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ok } from "./common";
import {
  defineKind,
  defineSection,
  defineTool,
  READ,
  type Registry,
} from "./defs";
import { REGISTRY } from "./registry";
import * as areas from "./tools/live";

const store = (file = "a.json") => {
  const settings = { activeProfile: { file, name: "A" } };
  return { getSettings: vi.fn(() => settings), settings };
};

// A section of two fields, one nested, saved by `write`
const stubRegistry = () => {
  let stored = { speed: 1, voice: { id: "x", pitch: 1 } };
  const write = vi.fn(async (_h: unknown, values: typeof stored) => {
    stored = values;
    return ok("Saved.");
  });
  const save = vi.fn(async (_h: unknown, id?: string) => ok({ id }));
  const test = vi.fn(async () => ok("Played."));
  const registry: Registry = {
    sections: {
      tts: defineSection({
        schema: z
          .object({
            speed: z.number().min(0.5).max(2),
            voice: z.object({ id: z.string(), pitch: z.number() }).strict(),
          })
          .strict(),
        read: () => stored,
        write,
        info: () => ({ hasKey: true }),
        notes: "Speed of the chat voice.",
      }),
    },
    kinds: {
      alerts: defineKind({
        schema: z.object({ name: z.string() }).strict(),
        testArgs: z.object({ text: z.string() }).strict(),
        list: (_h, args) => ok(args),
        save,
        test,
      }),
    },
    tools: [
      defineTool({
        name: "echo",
        title: "Echo",
        description: "Says it back.",
        input: z.object({ text: z.string() }).strict(),
        annotations: READ,
        run: (_h, { text }) => ok(text),
      }),
    ],
  };
  return { registry, write, save, test, stored: () => stored };
};

describe("MCP registry", () => {
  it("gives every tool all four annotations and a plain input", async () => {
    const { client } = await mcpClient(createHandler().handler);

    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.annotations).toEqual(
        expect.objectContaining({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        }),
      );
      expect(tool.inputSchema.type).toBe("object");
    }
    expect(tools.find((t) => t.name === "remove")?.annotations).toMatchObject({
      destructiveHint: true,
    });
  });

  it("names each section, kind and tool once across the areas", () => {
    const count = (key: "sections" | "kinds") =>
      Object.keys(REGISTRY[key]).length;
    expect(count("sections")).toBeGreaterThan(0);
    const names = REGISTRY.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(areas.kinds)).toContain("profiles");
  });

  describe("update_settings", () => {
    it("merges the changes onto the section and saves", async () => {
      const { registry, write, stored } = stubRegistry();
      const { call } = await mcpClient(
        createHandler({ storeManagerService: store() }).handler,
        registry,
      );

      const res = await call("update_settings", {
        section: "tts",
        changes: { voice: { pitch: 1.5 } },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      expect(stored()).toEqual({ speed: 1, voice: { id: "x", pitch: 1.5 } });
      expect(write).toHaveBeenCalledWith(expect.anything(), stored(), {
        voice: { pitch: 1.5 },
      });
    });

    it.each([
      ["a typo", { sped: 2 }, "sped"],
      ["a nested typo", { voice: { pich: 2 } }, "voice.pich"],
    ])("refuses %s and saves nothing", async (_name, changes, key) => {
      const { registry, write } = stubRegistry();
      const { call } = await mcpClient(
        createHandler({ storeManagerService: store() }).handler,
        registry,
      );

      const res = await call("update_settings", { section: "tts", changes });

      expect(res.isError).toBe(true);
      expect(res.text).toContain(key);
      expect(write).not.toHaveBeenCalled();
    });

    it("refuses values the section's schema refuses", async () => {
      const { registry, write } = stubRegistry();
      const { call } = await mcpClient(
        createHandler({ storeManagerService: store() }).handler,
        registry,
      );

      const res = await call("update_settings", {
        section: "tts",
        changes: { speed: 9 },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain("speed");
      expect(write).not.toHaveBeenCalled();
    });

    it("refuses when the profile changed while it read", async () => {
      const { registry, write } = stubRegistry();
      const s = store();
      registry.sections.tts.read = () => {
        s.settings.activeProfile = { file: "b.json", name: "B" };
        return { speed: 1, voice: { id: "x", pitch: 1 } };
      };
      const { call } = await mcpClient(
        createHandler({ storeManagerService: s }).handler,
        registry,
      );

      const res = await call("update_settings", {
        section: "tts",
        changes: { speed: 2 },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/profile changed/);
      expect(write).not.toHaveBeenCalled();
    });

    it("refuses an unknown section", async () => {
      const { registry } = stubRegistry();
      const { call } = await mcpClient(createHandler().handler, registry);

      const res = await call("update_settings", {
        section: "nope",
        changes: {},
      });

      expect(res.isError).toBe(true);
    });
  });

  it("reads a section with its info", async () => {
    const { registry } = stubRegistry();
    const { call } = await mcpClient(createHandler().handler, registry);

    expect((await call("get_settings", { section: "tts" })).value).toEqual({
      values: { speed: 1, voice: { id: "x", pitch: 1 } },
      hasKey: true,
    });
  });

  it("describes a section and a kind as JSON Schema", async () => {
    const { registry } = stubRegistry();
    const { call } = await mcpClient(createHandler().handler, registry);

    const tts = await call("describe", { name: "tts" });
    const alerts = await call("describe", { name: "alerts" });

    expect(tts.value).toMatchObject({
      section: {
        schema: {
          type: "object",
          properties: { speed: { type: "number", minimum: 0.5, maximum: 2 } },
          additionalProperties: false,
        },
        notes: "Speed of the chat voice.",
      },
    });
    expect(alerts.value).toMatchObject({
      kind: {
        schema: { properties: { name: { type: "string" } } },
        testArgs: { properties: { text: { type: "string" } } },
        can: ["list", "save", "test"],
      },
    });
    expect((await call("describe", { name: "nope" })).isError).toBe(true);
  });

  describe("kinds", () => {
    it("lists with the default limit", async () => {
      const { registry } = stubRegistry();
      const { call } = await mcpClient(createHandler().handler, registry);

      expect((await call("list", { kind: "alerts" })).value).toEqual({
        limit: 50,
      });
    });

    it("refuses a verb the kind doesn't have, and an unknown kind", async () => {
      const { registry } = stubRegistry();
      const { call } = await mcpClient(createHandler().handler, registry);

      expect((await call("remove", { kind: "alerts", id: "1" })).text).toBe(
        "The kind alerts can't remove.",
      );
      expect((await call("list", { kind: "nope" })).isError).toBe(true);
    });

    it("refuses unknown fields before saving", async () => {
      const { registry, save } = stubRegistry();
      const { call } = await mcpClient(createHandler().handler, registry);

      const bad = await call("save_item", {
        kind: "alerts",
        changes: { nmae: "x" },
      });
      const good = await call("save_item", {
        kind: "alerts",
        id: "7",
        changes: { name: "x" },
      });

      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("nmae");
      expect(good.value).toEqual({ id: "7" });
      expect(save).toHaveBeenCalledOnce();
    });

    it("checks a test's args", async () => {
      const { registry, test } = stubRegistry();
      const { call } = await mcpClient(createHandler().handler, registry);

      expect(
        (await call("test", { kind: "alerts", args: { txt: "hi" } })).isError,
      ).toBe(true);
      expect(
        (await call("test", { kind: "alerts", id: "1", args: { text: "hi" } }))
          .text,
      ).toBe("Played.");
      expect(test).toHaveBeenCalledExactlyOnceWith(expect.anything(), "1", {
        text: "hi",
      });
    });
  });

  it("turns a tool that throws into an error result", async () => {
    const { registry } = stubRegistry();
    registry.tools[0].run = () => {
      throw new Error("boom");
    };
    const { call } = await mcpClient(createHandler().handler, registry);

    const res = await call("echo", { text: "hi" });

    expect(res).toMatchObject({ isError: true });
    expect(res.text).toContain("boom");
  });

  it("refuses arguments a tool's input doesn't take", async () => {
    const { registry } = stubRegistry();
    const { call } = await mcpClient(createHandler().handler, registry);

    expect((await call("echo", { text: "hi", more: 1 })).isError).toBe(true);
    expect((await call("echo", { text: "hi" })).text).toBe("hi");
  });

  it("reads the status from the services", async () => {
    const { call } = await mcpClient(
      createHandler({
        storeManagerService: {
          getSettings: () => ({
            activeProfile: { name: "Main", file: "main.json" },
            activeFeatures: { tts: true, music: false, alerts: true },
            server: { enabled: true },
            accounts: { twitch: { id: "twitch:1", login: "mia", key: "" } },
          }),
          getLiveStats: () => ({ likes: 3, views: 4, viewers: 5 }),
        },
        connectorService: {
          isConnected: () => true,
          isReconnecting: () => true,
          isWaiting: () => false,
          status: () => ({ tiktok: "reconnecting", twitch: "waiting" }),
          username: "host",
        },
        liveService: {
          getSession: () => ({
            startedAt: 0,
            totals: {
              followers: 1,
              shares: 2,
              gifts: 3,
              coins: 40,
              kicks: 12,
              bits: 300,
              superChats: 2,
            },
            usd: 12.345,
            activity: [],
            viewers: [],
          }),
        },
        controlsService: { isPaused: () => true },
        musicService: {
          isActive: () => true,
          songs: () => [
            { title: "Song", thumbnail: "t", playing: true, played: false },
          ],
        },
        gamesService: { status: () => ({ minecraft: { state: "off" } }) },
        timerService: {
          get: () => ({ state: { status: "idle", remaining: 1000 } }),
        },
        serverService: { getPort: () => 37891 },
        updaterService: { getStatus: () => ({ state: "idle" }) },
      }).handler,
    );

    const { value } = await call("get_status");

    expect(value).toEqual({
      live: {
        connected: true,
        reconnecting: true,
        waiting: false,
        platforms: { tiktok: "reconnecting", twitch: "waiting" },
        username: "host",
        startedAt: "1970-01-01T00:00:00.000Z",
        viewers: 5,
        likes: 3,
        views: 4,
        followers: 1,
        shares: 2,
        gifts: 3,
        coins: 40,
        kicks: 12,
        bits: 300,
        superChats: { count: 2, usd: 12.35 },
        twitch: { signedIn: true, login: "mia" },
      },
      features: { tts: true, music: false, alerts: true },
      paused: true,
      profile: "Main",
      music: {
        connected: true,
        queue: [{ title: "Song", playing: true, played: false }],
      },
      minecraft: { state: "off" },
      timer: { status: "idle", remainingMs: 1000 },
      overlayServer: { enabled: true, port: 37891 },
      update: { state: "idle" },
    });
  });
});
