import {
  CatalogOverlay,
  mergeOverlayConfig,
  OverlayConfig,
  StudioOverlay,
  StudioOverlaySchema,
  TestOverlay,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  OverlayApp,
  TOKIO_EVENTS,
} from "@/common/types";
import overlays from "@/events/pages/overlays";
import studio from "@/events/pages/studio";
import tools from "@/events/pages/tools";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const app = (overrides: Partial<OverlayApp> = {}): OverlayApp => ({
  id: "gift-jar",
  name: "Gift Jar",
  version: "1.0.0",
  config: true,
  external: false,
  path: "overlays/gift-jar/index.html",
  ...overrides,
});

const entry = (overrides: Partial<CatalogOverlay> = {}): CatalogOverlay => ({
  id: "gift-jar",
  name: "Gift Jar",
  version: "1.1.0",
  description: "Fills a jar with the gifts of the LIVE.",
  config: true,
  url: "https://github.com/tokio-app/overlays/releases/download/v1/gift-jar.zip",
  size: 1024,
  sha256: "a".repeat(64),
  preview: null,
  ...overrides,
});

const config = (): OverlayConfig => ({
  sections: [{ id: "main", name: "Main", translations: { es: "Principal" } }],
  fields: [
    {
      id: "title",
      name: "Title",
      section: "main",
      type: "input",
      attributes: { mode: "text", value: "Gifts", default: "Gifts" },
    },
    {
      id: "speed",
      name: "Speed",
      section: "main",
      type: "slider",
      attributes: { value: 5, default: 5, min: 1, max: 10 },
    },
  ],
});

describe("overlays MCP tools", () => {
  describe("overlays", () => {
    const setup = () => {
      const served = [app(), app({ id: "chat", name: "Chat", external: true })];
      const getTestPayloads = vi.fn(() => [
        { type: TOKIO_EVENTS.FOLLOW } as const,
        { type: TOKIO_EVENTS.SHARE } as const,
      ]);
      const sendToClient = vi.fn(() => true);
      const remove = vi.fn(async () => ({ success: true, saved: true }));
      const h = createHandler(
        {
          overlayService: {
            getOverlays: () => served,
            getTestPayloads,
            remove,
          },
          serverService: { sendToClient },
          storeManagerService: {
            getSettings: () => ({ overlays: served }),
            getStudio: () => [],
          },
        },
        { stack: overlays },
      );
      return { h, getTestPayloads, sendToClient, remove };
    };

    it("lists them with their OBS links", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("list", { kind: "overlays", query: "chat" })).value,
      ).toEqual({
        total: 1,
        overlays: [
          {
            id: "chat",
            name: "Chat",
            version: "1.0.0",
            official: false,
            hasSettings: true,
            url: "http://tokio-app.local:37891/chat/",
          },
        ],
      });
    });

    it("removes one through REMOVE_OVERLAY", async () => {
      const { h, remove } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("remove", { kind: "overlays", id: "chat" })).text,
      ).toBe("Removed.");
      expect(remove).toHaveBeenCalledExactlyOnceWith("chat");
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toHaveLength(1);
    });

    it("refuses an id that isn't installed, without a notice", async () => {
      const { h, remove } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("remove", { kind: "overlays", id: "nope" });

      expect(res.isError).toBe(true);
      expect(remove).not.toHaveBeenCalled();
      expect(h.notices).toEqual([]);
    });

    it("sends a served overlay its test events", async () => {
      const { h, sendToClient } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("test", { kind: "overlays", id: "gift-jar" })).value,
      ).toEqual({ events: 2, reachedStream: true });
      expect(sendToClient).toHaveBeenCalledTimes(2);
      expect(sendToClient).toHaveBeenCalledWith("gift-jar", {
        type: TOKIO_EVENTS.SHARE,
      });
    });

    it("keeps no test LIVE for an id that isn't served", async () => {
      const { h, getTestPayloads } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("test", { kind: "overlays", id: "x" })).isError).toBe(
        true,
      );
      expect(getTestPayloads).not.toHaveBeenCalled();
    });
  });

  describe("overlay settings", () => {
    // A save as OverlayService makes it: merged onto what's on disk
    const setup = () => {
      let saved = config();
      const saveConfig = vi.fn(async (_id: string, next: OverlayConfig) => {
        saved = mergeOverlayConfig(saved, next);
        return { success: true, data: {} };
      });
      const h = createHandler(
        {
          overlayService: {
            getConfig: async (id: string) =>
              id === "gift-jar"
                ? { success: true, data: structuredClone(saved) }
                : { success: false },
            getGifts: async () => [],
            saveConfig,
          },
          serverService: { sendToClient: vi.fn(() => true) },
        },
        { stack: overlays },
      );
      return { h, saveConfig };
    };

    it("reads them", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      const { value } = await call("get", {
        kind: "overlay_settings",
        id: "gift-jar",
      });

      expect(value).toMatchObject({
        id: "gift-jar",
        settings: { fields: [{ id: "title" }, { id: "speed" }] },
      });
    });

    it("saves by field id and reports the values that didn't fit", async () => {
      const { h, saveConfig } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_overlay_settings", {
        id: "gift-jar",
        values: { title: "Roses", speed: 99 },
      });

      expect(res.value).toEqual({ saved: ["title"], dropped: ["speed"] });
      expect(saveConfig).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG)).toEqual([
        expect.objectContaining({ success: true, id: "gift-jar" }),
      ]);
    });

    it("refuses an unknown field", async () => {
      const { h, saveConfig } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_overlay_settings", {
        id: "gift-jar",
        values: { titel: "Roses" },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain("titel");
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it("refuses a value the schema refuses", async () => {
      const { h, saveConfig } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_overlay_settings", {
        id: "gift-jar",
        values: { speed: "fast" },
      });

      expect(res.isError).toBe(true);
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

  describe("official overlays", () => {
    const setup = (catalog: CatalogOverlay[], installed: OverlayApp[]) => {
      const installFromCatalog = vi.fn(async () => ({
        success: true,
        saved: true,
      }));
      const h = createHandler(
        {
          overlayService: {
            getCatalog: async () => ({ success: true, data: catalog }),
            getOverlays: () => installed,
            getGifts: async () => [],
            installFromCatalog,
          },
          storeManagerService: {
            getSettings: () => ({ overlays: installed }),
            getStudio: () => [],
          },
        },
        { stack: overlays },
      );
      return { h, installFromCatalog };
    };

    it("lists the catalog with each one's state", async () => {
      const { h } = setup(
        [entry(), entry({ id: "chat", name: "Chat", version: "2.0.0" })],
        [app({ id: "chat", version: "1.4.0" })],
      );
      const { call } = await mcpClient(h.handler);

      const { value } = await call("list", { kind: "official_overlays" });

      expect(value).toMatchObject({
        total: 2,
        overlays: [
          { id: "gift-jar", state: "install", installedVersion: null },
          { id: "chat", state: "breaking", installedVersion: "1.4.0" },
        ],
      });
    });

    it("installs one through INSTALL_OVERLAY", async () => {
      const { h, installFromCatalog } = setup([entry()], []);
      const { call } = await mcpClient(h.handler);

      const res = await call("install_overlay", { id: "gift-jar" });

      expect(res.value).toEqual({
        id: "gift-jar",
        version: "1.1.0",
        url: "http://tokio-app.local:37891/gift-jar/",
        state: "installed",
      });
      // With the entry it judged
      expect(installFromCatalog).toHaveBeenCalledExactlyOnceWith(
        "gift-jar",
        expect.anything(),
        entry(),
      );
      expect(h.pushed(APP_EVENTS_RESPONSE.INSTALL_OVERLAY)).toEqual([
        { success: true, id: "gift-jar" },
      ]);
    });

    it("refuses a breaking update until it's confirmed", async () => {
      const { h, installFromCatalog } = setup(
        [entry({ version: "2.0.0" })],
        [app()],
      );
      const { call } = await mcpClient(h.handler);

      const refused = await call("install_overlay", { id: "gift-jar" });
      expect(refused.isError).toBe(true);
      expect(installFromCatalog).not.toHaveBeenCalled();

      const res = await call("install_overlay", {
        id: "gift-jar",
        confirmBreaking: true,
      });
      expect(res.value).toMatchObject({ state: "updated" });
      expect(installFromCatalog).toHaveBeenCalledOnce();
    });

    it("installs only what the catalog has", async () => {
      const { h, installFromCatalog } = setup([entry()], []);
      const { call } = await mcpClient(h.handler);

      expect((await call("install_overlay", { id: "evil" })).isError).toBe(
        true,
      );
      expect(installFromCatalog).not.toHaveBeenCalled();
    });
  });

  describe("studio overlays", () => {
    const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";
    const setup = () => {
      const held: StudioOverlay[] = [
        StudioOverlaySchema.parse({ id: ID, name: "Overlay 1" }),
      ];
      const store = {
        getStudio: () => held,
        getLiveStats: () => ({ likes: 0, viewers: 0, views: 0 }),
        addStudioOverlay: vi.fn(async (id: string, name: string) => {
          held.push(StudioOverlaySchema.parse({ id, name }));
          return true;
        }),
        saveStudioOverlay: vi.fn(async (overlay: unknown) => {
          const saved = StudioOverlaySchema.parse(overlay);
          held.splice(
            held.findIndex((o) => o.id === saved.id),
            1,
            saved,
          );
          return true;
        }),
        removeStudioOverlay: vi.fn(async (id: string) => {
          held.splice(
            held.findIndex((o) => o.id === id),
            1,
          );
          return true;
        }),
      };
      const studioTest = vi.fn();
      const h = createHandler(
        {
          storeManagerService: store,
          overlayService: {
            getGifts: async () => [],
            getCustomGifts: async () => [],
            getOverlays: () => [],
          },
          liveService: {
            getSession: () => ({
              startedAt: null,
              totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
              activity: [],
            }),
          },
          studioService: {
            kept: () => null,
            forget: vi.fn(),
            test: studioTest,
          },
          serverService: { sendToClient: vi.fn(() => true), cameraKey: "k" },
        },
        { stack: studio },
      );
      return { h, held, store, studioTest };
    };

    const text = {
      kind: "text",
      id: "t1",
      x: 0,
      y: 0,
      width: 400,
      height: 100,
      text: "{likes} likes",
    };

    it("creates one with ADD_STUDIO_OVERLAY, then saves the rest", async () => {
      const { h, held, store } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "studio_overlay",
        changes: { size: "landscape", items: [text] },
      });

      expect(res.isError).toBe(false);
      const created = held[1];
      expect(res.value).toEqual({
        id: created.id,
        name: "Overlay 2",
        url: `http://tokio-app.local:37891/studio/${created.id}/`,
      });
      expect(created).toMatchObject({ size: "landscape", items: [text] });
      expect(invoke.mock.calls.map(([event]) => event)).toEqual([
        APP_EVENTS.ADD_STUDIO_OVERLAY,
        APP_EVENTS.SAVE_STUDIO_OVERLAY,
      ]);
      expect(store.addStudioOverlay).toHaveBeenCalledOnce();
    });

    it("merges changes onto a stored one", async () => {
      const { h, held } = setup();
      const { call } = await mcpClient(h.handler);

      await call("save_item", {
        kind: "studio_overlay",
        id: ID,
        changes: { name: "Goals" },
      });

      expect(held[0]).toMatchObject({
        id: ID,
        name: "Goals",
        size: "portrait",
      });
    });

    it("refuses an unknown field inside an element", async () => {
      const { h, store } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "studio_overlay",
        id: ID,
        changes: {
          items: [
            { kind: "group", id: "g", elements: [{ ...text, colour: "#fff" }] },
          ],
        },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain("items.0.elements.0.colour");
      expect(store.saveStudioOverlay).not.toHaveBeenCalled();
    });

    it("refuses an unknown field inside also_triggers and counters", async () => {
      const { h, store } = setup();
      const { call } = await mcpClient(h.handler);
      const share = { type: "tokio:event:share", gifts: [] };

      const res = await call("save_item", {
        kind: "studio_overlay",
        id: ID,
        changes: {
          counters: [
            { name: "shares_now", trigger: share },
            { name: "x", trigger: share, every: 2 },
          ],
          items: [
            {
              kind: "group",
              id: "g",
              also_triggers: [{ ...share, delay: 1 }],
              elements: [
                {
                  ...text,
                  also_triggers: [
                    share,
                    { type: "tokio:studio:goal", number: "likes", goals: 5 },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain(
        "items.0.also_triggers.0.delay, items.0.elements.0.also_triggers.1.goals, counters.1.every",
      );
      expect(store.saveStudioOverlay).not.toHaveBeenCalled();
    });

    it("refuses a counter with no name, a taken one or a repeated one", async () => {
      const { h, held, store } = setup();
      const { call } = await mcpClient(h.handler);
      const save = (...names: string[]) =>
        call("save_item", {
          kind: "studio_overlay",
          id: ID,
          changes: {
            counters: names.map((name) => ({
              name,
              trigger: { type: "tokio:event:gift", gifts: [] },
            })),
          },
        });

      for (const [names, text] of [
        [["roses", ""], "counters.1 needs a name. Nothing was saved."],
        [["likes"], "counters.0: {likes} is a LIVE number"],
        [["username"], "counters.0: {username} is a LIVE number"],
        [["roses", "roses"], "counters.1: another counter is roses."],
      ] as const) {
        const res = await save(...names);
        expect(res.isError).toBe(true);
        expect(res.text).toContain(text);
      }
      expect(store.saveStudioOverlay).not.toHaveBeenCalled();

      expect((await save("roses", "lions")).isError).toBe(false);
      expect(held[0].counters.map((c) => c.name)).toEqual(["roses", "lions"]);
    });

    it("adds nothing when the new overlay doesn't parse", async () => {
      const { h, store } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "studio_overlay",
        changes: { size: "square" },
      });

      expect(res.isError).toBe(true);
      expect(store.addStudioOverlay).not.toHaveBeenCalled();
    });

    it("lists, tests and removes", async () => {
      const { h, held, studioTest } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("list", { kind: "studio_overlay" })).value).toEqual({
        total: 1,
        overlays: [
          {
            id: ID,
            name: "Overlay 1",
            size: "portrait",
            items: 0,
            url: `http://tokio-app.local:37891/studio/${ID}/`,
          },
        ],
      });
      expect(
        (await call("test", { kind: "studio_overlay", id: ID })).isError,
      ).toBe(false);
      expect(studioTest).toHaveBeenCalledOnce();
      await call("remove", { kind: "studio_overlay", id: ID });
      expect(held).toEqual([]);
    });

    describe("edit_studio_overlay", () => {
      const Edited = z.object({
        added: z.array(z.string()),
        items: z.array(z.unknown()),
      });
      // Group g holding a and b, then t on its own in front
      const seeded = () => {
        const s = setup();
        s.held[0] = StudioOverlaySchema.parse({
          id: ID,
          name: "Overlay 1",
          items: [
            {
              kind: "group",
              id: "g",
              name: "Goals",
              elements: [
                { ...text, id: "a" },
                { ...text, id: "b" },
              ],
            },
            text,
          ],
        });
        return s;
      };
      const idsOf = (overlay: StudioOverlay) =>
        overlay.items.flatMap((i) =>
          i.kind === "group" ? [i.id, ...i.elements.map((e) => e.id)] : [i.id],
        );
      const edit = async (h: ReturnType<typeof setup>["h"], ops: unknown[]) =>
        (await mcpClient(h.handler)).call("edit_studio_overlay", {
          id: ID,
          ops,
        });

      it("adds items with their kind's defaults and new ids", async () => {
        const { h, held } = seeded();

        const res = await edit(h, [
          { op: "add", item: { kind: "viewer" } },
          { op: "add", item: { kind: "group", elements: [{ kind: "text" }] } },
          { op: "add", item: { kind: "shape", id: "s" }, behind: "b" },
        ]);

        expect(res.isError).toBe(false);
        const { added, items } = Edited.parse(res.value);
        expect(added).toHaveLength(4);
        expect(added[0]).toMatch(/^[0-9a-f]{8}$/);
        const viewer = held[0].items.find((i) => i.id === added[0]);
        expect(viewer).toMatchObject({ kind: "viewer", when: "event" });
        expect(held[0].items[3]).toMatchObject({
          kind: "group",
          name: "Group 1",
          elements: [{ id: added[2], kind: "text" }],
        });
        expect(items).toContainEqual({
          id: "s",
          kind: "shape",
          label: "",
          group: "g",
        });
        expect(
          held[0].items[0].kind === "group" &&
            held[0].items[0].elements.map((e) => e.id),
        ).toEqual(["a", "s", "b"]);
      });

      it("changes, moves and removes items, in order", async () => {
        const { h, held } = seeded();

        const res = await edit(h, [
          { op: "change", id: "a", set: { text: "hi", x: 5 } },
          { op: "move", id: "t1", group: "g" },
          { op: "move", id: "b", behind: "a" },
          { op: "move", id: "a", group: null },
          { op: "change", id: "g", set: { name: "Top" } },
          { op: "remove", id: "t1" },
        ]);

        expect(res.isError).toBe(false);
        expect(Edited.parse(res.value).items).toEqual([
          { id: "g", kind: "group", name: "Top" },
          { id: "b", kind: "text", label: "", group: "g" },
          { id: "a", kind: "text", label: "" },
        ]);
        expect(held[0].items[1]).toMatchObject({ text: "hi", x: 5, y: 0 });
      });

      it("removes a group with its elements", async () => {
        const { h, held } = seeded();

        await edit(h, [{ op: "remove", id: "g" }]);

        expect(held[0].items.map((i) => i.id)).toEqual(["t1"]);
      });

      it.each([
        [[{ op: "remove", id: "nope" }], "No item nope"],
        [
          [{ op: "change", id: "a", set: { colour: "#fff" } }],
          "ops.0.set.colour",
        ],
        [[{ op: "change", id: "a", set: { kind: "shape" } }], "kind"],
        [[{ op: "change", id: "g", set: { elements: [] } }], "elements"],
        [[{ op: "move", id: "g", behind: "a" }], "A group can't go into"],
        [[{ op: "add", item: { kind: "group" }, group: "g" }], "into a group"],
        [[{ op: "add", item: { kind: "text", id: "a" } }], "taken"],
        [[{ op: "add", item: { kind: "text", rounding: 9 } }], "rounding"],
        [
          [
            {
              op: "change",
              id: "g",
              set: { also_triggers: [{ type: "tokio:event:share", x: 1 }] },
            },
          ],
          "ops.0.set.also_triggers.0.x",
        ],
        [
          [
            {
              op: "add",
              item: { kind: "text", also_triggers: [{ type: "x", typo: 1 }] },
            },
          ],
          "ops.0.item.also_triggers.0.typo",
        ],
      ])("refuses a bad op: %j", async (ops, message) => {
        const { h, store } = seeded();

        const res = await edit(h, ops);

        expect(res.isError).toBe(true);
        expect(res.text).toContain(message);
        expect(store.saveStudioOverlay).not.toHaveBeenCalled();
      });

      it("saves nothing when a later op fails", async () => {
        const { h, held, store } = seeded();

        const res = await edit(h, [
          { op: "remove", id: "a" },
          { op: "change", id: "b", set: { width: -1 } },
        ]);

        expect(res.isError).toBe(true);
        expect(res.text).toContain("ops.1 (change b)");
        expect(store.saveStudioOverlay).not.toHaveBeenCalled();
        expect(idsOf(held[0])).toEqual(["g", "a", "b", "t1"]);
      });
    });

    it("duplicates with get and save_item", async () => {
      const { h, held } = setup();
      held[0] = StudioOverlaySchema.parse({ id: ID, items: [text] });
      const { call } = await mcpClient(h.handler);

      const {
        id: _id,
        url: _url,
        ...fields
      } = z
        .record(z.string(), z.unknown())
        .parse((await call("get", { kind: "studio_overlay", id: ID })).value);
      const res = await call("save_item", {
        kind: "studio_overlay",
        changes: fields,
      });

      expect(res.isError).toBe(false);
      expect(held[1].id).not.toBe(ID);
      expect(held[1].items).toEqual(held[0].items);
    });
  });

  describe("test overlays", () => {
    const setup = () => {
      let held: TestOverlay[] = [{ id: "a1", name: "Goal" }];
      const h = createHandler(
        {
          overlayService: {
            getTestOverlays: () => held,
            createTestOverlay: async (name: string) => {
              held = [...held, { id: "b2", name: name.trim() }];
              return { success: true, saved: true, data: held };
            },
            removeTestOverlay: async (id: string) => {
              held = held.filter((o) => o.id !== id);
              return { success: true, saved: true, data: held };
            },
            sendTestEvents: vi.fn(() => ({ success: false })),
          },
        },
        { stack: tools },
      );
      return { h, held: () => held };
    };

    it("adds one and gives its id", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (
          await call("save_item", {
            kind: "test_overlay",
            changes: { name: "Browser" },
          })
        ).value,
      ).toEqual({ id: "b2", name: "Browser" });
    });

    it("can't rename one", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "test_overlay",
        id: "a1",
        changes: { name: "Other" },
      });

      expect(res.isError).toBe(true);
    });

    it("says when no overlay is connected with its id", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("test", { kind: "test_overlay", id: "a1" })).value,
      ).toEqual({ reachedOverlay: false });
      expect(
        (await call("test", { kind: "test_overlay", id: "zz" })).isError,
      ).toBe(true);
    });

    it("removes one", async () => {
      const { h, held } = setup();
      const { call } = await mcpClient(h.handler);

      await call("remove", { kind: "test_overlay", id: "a1" });

      expect(held()).toEqual([]);
    });
  });
});
