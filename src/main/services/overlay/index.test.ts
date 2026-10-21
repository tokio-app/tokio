import { OverlayMetadata, TestOverlay } from "@/common/schemas";
import { CustomGift, GiftEvent, TOKIO_EVENTS } from "@/common/types";
import { defaultStoreData, generateTikTokEventSample } from "@/common/util";
import { JSONManagerService } from "@/services/json";
import { ServerService } from "@/services/server";
import { YAMLManagerService } from "@/services/yaml";
import { strToU8, zipSync } from "fflate";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from "vitest";
import { processHTML } from "./common";
import { CATALOG_URL, RELEASES_PREFIX } from "./common/catalog";
import { CATALOG_TTL_MS, OverlayService } from "./index";

vi.mock("./common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./common")>();
  return { ...actual, processHTML: vi.fn(actual.processHTML) };
});

const SETUP = '<script id="tokio-setup"></script>';

const info = (name: string, config = false) =>
  `name: ${name}\nversion: 1.0.0\nconfig: ${config}\n`;

const config = (value: string) =>
  [
    "sections:",
    "  - { name: Main, id: main }",
    "fields:",
    "  - name: Title",
    "    id: title",
    "    section: main",
    "    type: input",
    `    attributes: { mode: text, value: ${value}, default: Hello }`,
  ].join("\n");

const gifts: CustomGift[] = [{ value: 1, label: "Rose", img: "", coins: 1 }];

// A release of an official overlay's zip, as tokio-overlays builds it, with
// its settings at their defaults.
const release = (version: string, files: Record<string, string> = {}) => {
  const zip = zipSync(
    Object.fromEntries(
      Object.entries({
        "info.yaml": `name: Gift Jar\nversion: ${version}\nconfig: true\n`,
        "config.yaml": config("Hello"),
        "index.html": `<body>${SETUP}</body>`,
        ...files,
      }).map(([name, content]) => [name, strToU8(content)]),
    ),
  );
  return {
    zip,
    entry: {
      id: "gift-jar",
      name: "Gift Jar",
      version,
      description: "Gifts drop into a jar.",
      config: true,
      url: `${RELEASES_PREFIX}v${version}/gift-jar.zip`,
      size: zip.length,
      sha256: createHash("sha256").update(zip).digest("hex"),
      preview: null,
    },
  };
};

// Serves a catalog of the releases and their zips.
const publish = (...releases: ReturnType<typeof release>[]) => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === CATALOG_URL) {
      return Response.json({
        schema: 1,
        release: "0.1.1",
        overlays: releases.map((r) => r.entry),
      });
    }
    const found = releases.find((r) => r.entry.url === url);
    return found
      ? new Response(found.zip)
      : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("OverlayService", () => {
  let root: string;
  let folder: string;
  let service: OverlayService;
  let stored: (OverlayMetadata & { id: string })[];
  let testOverlays: TestOverlay[];
  let rebuilt: boolean;
  let mount: MockInstance<ServerService["mount"]>;
  let unmount: MockInstance<ServerService["unmount"]>;
  let sendToClient: MockInstance<ServerService["sendToClient"]>;

  const store = {
    wasRebuilt: () => rebuilt,
    getSettings: () => ({
      ...defaultStoreData.settings,
      overlays: structuredClone(stored),
      testOverlays: structuredClone(testOverlays),
    }),
    addOverlayInfo: async (o: OverlayMetadata & { id: string }) => {
      stored.push(o);
    },
    updateOverlayInfo: async (o: OverlayMetadata & { id: string }) => {
      stored = stored.map((s) => (s.id === o.id ? o : s));
    },
    removeOverlayInfo: async (id: string) => {
      stored = stored.filter((o) => o.id !== id);
    },
    addTestOverlay: async (o: TestOverlay) => {
      testOverlays.push(o);
    },
    removeTestOverlay: async (id: string) => {
      testOverlays = testOverlays.filter((o) => o.id !== id);
    },
  };

  const overlay = async (dir: string, files: Record<string, string>) => {
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
    }
  };

  const configurable = (dir: string) =>
    overlay(dir, {
      "info.yaml": info("Title", true),
      "config.yaml": config("Saved"),
      "index.html": `<body>${SETUP}</body>`,
    });

  const readJSON = async (name: string) =>
    JSON.parse(await readFile(join(root, name), "utf-8"));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tokio-test-"));
    folder = join(root, "overlays");
    await mkdir(folder);
    stored = [];
    testOverlays = [];
    rebuilt = false;
    // Not started, it only keeps the routes.
    const server = new ServerService(0);
    mount = vi.spyOn(server, "mount");
    unmount = vi.spyOn(server, "unmount");
    sendToClient = vi.spyOn(server, "sendToClient");
    service = new OverlayService();
    service.initialize(
      {
        folder,
        giftsFile: join(root, "gifts.json"),
        customGiftsFile: join(root, "custom-gifts.json"),
      },
      {
        yaml: new YAMLManagerService(),
        json: new JSONManagerService(),
        server,
        store,
      },
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  describe("load", () => {
    it("serves the overlays that load and forgets the rest", async () => {
      await configurable(join(folder, "title"));
      await overlay(join(folder, "broken"), { "info.yaml": info("Broken") });
      stored = [
        { id: "title", name: "Title", version: "1.0.0", config: true },
        { id: "broken", name: "Broken", version: "1.0.0", config: false },
      ];

      await service.load(gifts);

      expect(mount).toHaveBeenCalledExactlyOnceWith(
        "title",
        join(folder, "title"),
        false,
      );
      expect(stored.map((o) => o.id)).toEqual(["title"]);
      expect(service.getOverlays()).toMatchObject([
        { id: "title", path: join(folder, "title", "index.html") },
      ]);
      expect(
        await readFile(join(folder, "title", "index.html"), "utf-8"),
      ).toContain(`window.__OVERLAY_CONFIG__ = {"title":"Saved"}`);
      expect(await readJSON("gifts.json")).toEqual(gifts);
    });

    it("writes gifts that changed after load into the loaded overlays", async () => {
      await configurable(join(folder, "title"));
      stored = [{ id: "title", name: "Title", version: "1.0.0", config: true }];
      await service.load(gifts);
      const lion = { value: 2, label: "Lion", img: "", coins: 29999 };
      vi.mocked(processHTML).mockClear();

      await service.refreshGifts([...gifts, lion]);

      expect(processHTML).toHaveBeenCalledOnce();
      expect(vi.mocked(processHTML).mock.calls[0][5]).toEqual([...gifts, lion]);
      expect(await service.getGifts()).toEqual([...gifts, lion]);
      expect(await readJSON("gifts.json")).toEqual([...gifts, lion]);
    });

    it("leaves the overlays alone when the gifts didn't change", async () => {
      await configurable(join(folder, "title"));
      stored = [{ id: "title", name: "Title", version: "1.0.0", config: true }];
      await service.load(gifts);
      vi.mocked(processHTML).mockClear();

      await service.refreshGifts(structuredClone(gifts));

      expect(processHTML).not.toHaveBeenCalled();
    });

    it("doesn't serve an overlay whose HTML can't be written", async () => {
      await configurable(join(folder, "title"));
      stored = [{ id: "title", name: "Title", version: "1.0.0", config: true }];
      vi.mocked(processHTML).mockResolvedValueOnce({ success: false });

      await service.load(gifts);

      expect(mount).not.toHaveBeenCalled();
      expect(stored).toEqual([]);
      expect(service.getOverlays()).toEqual([]);
    });

    it("recovers the installed overlays when the store was rebuilt", async () => {
      // Imported overlays are named by a UUID, official ones by their id.
      const imported = "0b5c6a52-3f7e-4c1a-9d0e-2a4b6c8d0e1f";
      await overlay(join(folder, imported), {
        "info.yaml": info("Clock"),
        "index.html": "<h1>clock</h1>",
      });
      await overlay(join(folder, "gift-jar"), {
        "info.yaml": info("Gift Jar"),
        "index.html": "<h1>jar</h1>",
      });
      rebuilt = true;

      await service.load(gifts);

      expect(stored).toMatchObject([
        { id: imported, name: "Clock", external: true },
        { id: "gift-jar", name: "Gift Jar", external: false },
      ]);
      expect(mount).toHaveBeenCalledWith(
        imported,
        join(folder, imported),
        false,
      );
    });

    it("deletes what an install cut short left behind", async () => {
      await configurable(join(folder, ".install-1"));
      await configurable(join(folder, ".old-2"));
      rebuilt = true;

      await service.load(gifts);

      expect(await readdir(folder)).toEqual([]);
      expect(stored).toEqual([]);
    });
  });

  describe("gifts", () => {
    // A gift as the connector sends it
    const sent = (
      id: string,
      name = `Gift ${id}`,
      image = `${id}.png`,
    ): GiftEvent["gift"] => ({
      id,
      name,
      image,
      coins: 10,
      type: 1,
      repeatEnd: true,
      comboCount: 1,
    });

    const saved = (
      value: number,
      label = `Gift ${value}`,
      img = `${value}.png`,
    ): CustomGift => ({ value, label, img, coins: 10 });

    it("keeps TikTok's list once read", async () => {
      await writeFile(join(root, "gifts.json"), JSON.stringify(gifts));
      expect(await service.getGifts()).toEqual(gifts);

      await writeFile(join(root, "gifts.json"), "[]");

      expect(await service.getGifts()).toEqual(gifts);
    });

    it("has no custom gifts before the first one is saved", async () => {
      expect(await service.getCustomGifts()).toEqual([]);
    });

    it("reads the custom gifts saved last time", async () => {
      await writeFile(
        join(root, "custom-gifts.json"),
        JSON.stringify([saved(9)]),
      );

      expect(await service.getCustomGifts()).toEqual([saved(9)]);
    });

    describe("recordGift", () => {
      beforeEach(async () => {
        await service.load(gifts);
      });

      it("saves a gift TikTok's list doesn't have", async () => {
        const res = await service.recordGift(sent("9", "Galaxy"));

        expect(res).toEqual({ success: true, data: [saved(9, "Galaxy")] });
        expect(await readJSON("custom-gifts.json")).toEqual(res.data);
        expect(await service.getCustomGifts()).toEqual(res.data);
      });

      it("adds gifts in the order they're sent, and returns the list only when it changed", async () => {
        await service.recordGift(sent("9"));
        const res = await service.recordGift(sent("8"));
        const again = await service.recordGift(sent("9"));

        expect(res.data).toEqual([saved(9), saved(8)]);
        expect(again).toEqual({ success: true });
      });

      it("leaves out the gifts TikTok lists", async () => {
        expect(await service.recordGift(sent("1", "Rose"))).toEqual({
          success: true,
        });
        expect(await service.getCustomGifts()).toEqual([]);
      });

      it("saves nothing while TikTok's list is empty", async () => {
        await service.load([]);

        expect(await service.recordGift(sent("9"))).toEqual({
          success: true,
        });
        expect(await service.getCustomGifts()).toEqual([]);
      });

      it.each([
        { what: "no id", gift: sent("") },
        { what: "an id that isn't a number", gift: sent("rose") },
        { what: "no name", gift: sent("9", "") },
      ])("skips a gift with $what", async ({ gift }) => {
        expect(await service.recordGift(gift)).toEqual({ success: true });
        expect(await service.getCustomGifts()).toEqual([]);
      });

      it("keeps both gifts of events sent at the same time", async () => {
        await Promise.all([
          service.recordGift(sent("9")),
          service.recordGift(sent("8")),
        ]);

        expect(await readJSON("custom-gifts.json")).toEqual([
          saved(9),
          saved(8),
        ]);
      });

      it("updates a saved gift's details once per run", async () => {
        await writeFile(
          join(root, "custom-gifts.json"),
          JSON.stringify([saved(9, "Old", "old.png")]),
        );

        const res = await service.recordGift(sent("9", "New", "new.png"));
        const again = await service.recordGift(sent("9", "Newer", "newer.png"));

        expect(res.data).toEqual([saved(9, "New", "new.png")]);
        expect(again).toEqual({ success: true });
      });

      it("tries a gift again after a failed save", async () => {
        // A folder where the file goes
        await mkdir(join(root, "custom-gifts.json"));

        expect(await service.recordGift(sent("9"))).toEqual({
          success: false,
        });
        expect(await service.getCustomGifts()).toEqual([]);

        await rm(join(root, "custom-gifts.json"), { recursive: true });

        expect((await service.recordGift(sent("9"))).data).toEqual([saved(9)]);
      });
    });
  });

  describe("import", () => {
    it("copies the overlay with its defaults and serves it", async () => {
      const source = join(root, "source");
      await configurable(source);

      expect(await service.import(source, gifts)).toEqual({ success: true });

      const [id] = await readdir(folder);
      expect(stored).toMatchObject([{ id, name: "Title", external: true }]);
      expect(mount).toHaveBeenCalledWith(id, join(folder, id), true);
      const html = await readFile(join(folder, id, "index.html"), "utf-8");
      expect(html).toContain(`window.__OVERLAY_CONFIG__ = {"title":"Hello"}`);
      expect(html).toContain(`window.__OVERLAY_ID__ = "${id}"`);
      // The source is left as it was.
      expect(await readFile(join(source, "index.html"), "utf-8")).toBe(
        `<body>${SETUP}</body>`,
      );
    });

    it("leaves out links to files outside the overlay", async () => {
      const source = join(root, "source");
      await configurable(source);
      const secret = join(root, "secret");
      await overlay(secret, { "key.txt": "private" });
      // A junction needs no admin rights on Windows, elsewhere it's a link.
      await symlink(secret, join(source, "data"), "junction");

      expect(await service.import(source, gifts)).toEqual({ success: true });

      const [id] = await readdir(folder);
      expect(await readdir(join(folder, id))).not.toContain("data");
    });

    it("writes settings with dollar signs as they are", async () => {
      const source = join(root, "source");
      await overlay(source, {
        "info.yaml": info("Title", true),
        "config.yaml": config("Saved").replace(
          "default: Hello",
          () => 'default: "Make $$$ now"',
        ),
        "index.html": `<body>${SETUP}</body>`,
      });

      expect(await service.import(source, gifts)).toEqual({ success: true });

      const [id] = await readdir(folder);
      const html = await readFile(join(folder, id, "index.html"), "utf-8");
      expect(html).toContain('{"title":"Make $$$ now"}');
    });

    it("gives an overlay without settings its ID", async () => {
      const source = join(root, "source");
      await overlay(source, {
        "info.yaml": info("Clock"),
        "index.html": `<body>${SETUP}</body>`,
      });

      expect(await service.import(source, gifts)).toEqual({ success: true });

      const [id] = await readdir(folder);
      const html = await readFile(join(folder, id, "index.html"), "utf-8");
      expect(html).toContain(
        `<script id="tokio-setup"> window.__OVERLAY_ID__ = "${id}"; </script>`,
      );
    });

    it("rejects an overlay without the setup block", async () => {
      const source = join(root, "source");
      await overlay(source, {
        "info.yaml": info("Clock"),
        "index.html": "<h1>clock</h1>",
      });

      expect(await service.import(source, gifts)).toEqual({ success: false });
      expect(await readdir(folder)).toEqual([]);
      expect(stored).toEqual([]);
    });

    it("rejects a folder that isn't an overlay", async () => {
      const source = join(root, "source");
      await overlay(source, { "index.html": "<p></p>" });

      expect(await service.import(source, gifts)).toEqual({ success: false });
      expect(await readdir(folder)).toEqual([]);
      expect(stored).toEqual([]);
    });

    it("removes the copy when its HTML can't be written", async () => {
      const source = join(root, "source");
      await configurable(source);
      vi.mocked(processHTML).mockResolvedValueOnce({ success: false });

      expect(await service.import(source, gifts)).toEqual({ success: false });
      expect(await readdir(folder)).toEqual([]);
      expect(mount).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes an imported overlay and stops serving it", async () => {
      const source = join(root, "source");
      await configurable(source);
      await service.import(source, gifts);
      const [id] = await readdir(folder);

      expect(await service.remove(id)).toEqual({ success: true });

      expect(await readdir(folder)).toEqual([]);
      expect(stored).toEqual([]);
      expect(unmount).toHaveBeenCalledWith(id);
      expect(service.getOverlays()).toEqual([]);
    });

    it("refuses an id that isn't stored", async () => {
      await configurable(join(folder, "title"));

      expect(await service.remove("..")).toMatchObject({ success: false });
      expect(await service.remove("title")).toMatchObject({ success: false });

      expect(await readdir(root)).toContain("overlays");
      expect(await readdir(folder)).toEqual(["title"]);
      expect(unmount).not.toHaveBeenCalled();
    });

    it("deletes an official overlay", async () => {
      await configurable(join(folder, "title"));
      stored = [{ id: "title", name: "Title", version: "1.0.0", config: true }];

      expect(await service.remove("title")).toEqual({ success: true });

      expect(await readdir(folder)).toEqual([]);
      expect(stored).toEqual([]);
      expect(unmount).toHaveBeenCalledWith("title");
    });
  });

  describe("getCatalog", () => {
    it("reads the catalog again only after a while", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fetchMock = publish(release("1.0.0"));

      expect(await service.getCatalog()).toEqual({
        success: true,
        data: [release("1.0.0").entry],
      });
      await service.getCatalog();
      expect(fetchMock).toHaveBeenCalledOnce();

      vi.setSystemTime(Date.now() + CATALOG_TTL_MS);
      await service.getCatalog();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("tries again after a failure", async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      vi.stubGlobal("fetch", fetchMock);

      expect(await service.getCatalog()).toEqual({ success: false });
      expect(await service.getCatalog()).toEqual({ success: false });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("installFromCatalog", () => {
    const dir = () => join(folder, "gift-jar");

    it("serves an official overlay under its catalog id", async () => {
      publish(release("1.0.0"));

      expect(await service.installFromCatalog("gift-jar", gifts)).toEqual({
        success: true,
      });

      expect(await readdir(folder)).toEqual(["gift-jar"]);
      expect(stored).toEqual([
        {
          id: "gift-jar",
          name: "Gift Jar",
          version: "1.0.0",
          config: true,
          external: false,
        },
      ]);
      expect(mount).toHaveBeenCalledExactlyOnceWith("gift-jar", dir(), true);
      const html = await readFile(join(dir(), "index.html"), "utf-8");
      expect(html).toContain(`window.__OVERLAY_ID__ = "gift-jar"`);
      expect(html).toContain(`window.__OVERLAY_CONFIG__ = {"title":"Hello"}`);
    });

    it("updates an installed overlay and keeps its settings", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      publish(release("1.0.0", { "old.js": "1" }));
      await service.installFromCatalog("gift-jar", gifts);
      const saved = (await service.getConfig("gift-jar")).data!;
      const field = saved.fields[0];
      if (field.type !== "input") throw new Error("Expected an input field");
      field.attributes.value = "Mine";
      await service.saveConfig("gift-jar", saved, gifts);
      mount.mockClear();

      vi.setSystemTime(Date.now() + CATALOG_TTL_MS);
      publish(release("1.0.1", { "new.js": "2" }));
      expect(await service.installFromCatalog("gift-jar", gifts)).toEqual({
        success: true,
      });

      // No staging folder or old copy is left.
      expect(await readdir(folder)).toEqual(["gift-jar"]);
      expect((await readdir(dir())).sort()).toEqual([
        "config.yaml",
        "index.html",
        "info.yaml",
        "new.js",
      ]);
      expect(stored).toMatchObject([{ id: "gift-jar", version: "1.0.1" }]);
      expect(service.getOverlays()).toMatchObject([
        { id: "gift-jar", version: "1.0.1", external: false },
      ]);
      expect(mount).not.toHaveBeenCalled();
      expect(
        (await service.getConfig("gift-jar")).data!.fields[0].attributes.value,
      ).toBe("Mine");
      expect(await readFile(join(dir(), "index.html"), "utf-8")).toContain(
        `window.__OVERLAY_CONFIG__ = {"title":"Mine"}`,
      );
    });

    it("leaves nothing behind when the download doesn't match", async () => {
      const broken = release("1.0.0");
      broken.entry.sha256 = "0".repeat(64);
      publish(broken);

      expect(await service.installFromCatalog("gift-jar", gifts)).toEqual({
        success: false,
      });

      expect(await readdir(folder)).toEqual([]);
      expect(stored).toEqual([]);
      expect(mount).not.toHaveBeenCalled();
    });

    it("refuses a download that isn't a valid overlay", async () => {
      publish(release("1.0.0", { "index.html": "<body></body>" }));

      expect(await service.installFromCatalog("gift-jar", gifts)).toEqual({
        success: false,
      });
      expect(await readdir(folder)).toEqual([]);
    });

    it("fails for an overlay that isn't in the catalog", async () => {
      publish(release("1.0.0"));

      expect(await service.installFromCatalog("top-likes", gifts)).toEqual({
        success: false,
      });
      expect(await readdir(folder)).toEqual([]);
    });

    it("installs once when asked twice at the same time", async () => {
      const fetchMock = publish(release("1.0.0"));

      const results = await Promise.all([
        service.installFromCatalog("gift-jar", gifts),
        service.installFromCatalog("gift-jar", gifts),
      ]);

      expect(results).toEqual([{ success: true }, { success: true }]);
      expect(stored).toHaveLength(1);
      // The catalog, then the zip
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("saves a config into the overlay's HTML and config file", async () => {
    await configurable(join(folder, "title"));
    const res = await service.getConfig("title");
    const field = res.data!.fields[0];
    if (field.type !== "input") throw new Error("Expected an input field");
    field.attributes.value = "Changed";

    expect(await service.saveConfig("title", res.data!, gifts)).toEqual({
      success: true,
      data: { title: "Changed" },
    });
    expect(
      await readFile(join(folder, "title", "index.html"), "utf-8"),
    ).toContain(`window.__OVERLAY_CONFIG__ = {"title":"Changed"}`);
    expect((await service.getConfig("title")).data).toEqual(res.data);
  });

  it("fails to get the config of a missing overlay", async () => {
    expect(await service.getConfig("missing")).toEqual({
      success: false,
      data: undefined,
    });
  });

  it("sends data to one overlay", () => {
    const payload = generateTikTokEventSample(TOKIO_EVENTS.FOLLOW);

    service.send("a", payload);

    expect(sendToClient).toHaveBeenCalledExactlyOnceWith("a", payload);
  });

  it("samples every live event for tests", () => {
    const types = service.getTestPayloads().map((p) => p.type);

    expect(types).toContain(TOKIO_EVENTS.CHAT);
    expect(types).not.toContain(TOKIO_EVENTS.CONNECTED);
    expect(types).not.toContain(TOKIO_EVENTS.DISCONNECTED);
    expect(types).not.toContain(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED);
  });

  describe("test overlays", () => {
    it("creates a named id and removes it", async () => {
      const created = await service.createTestOverlay("  Gift goal  ");

      expect(created.success).toBe(true);
      expect(created.data).toEqual([
        { id: expect.any(String), name: "Gift goal" },
      ]);
      expect(service.getTestOverlays()).toEqual(created.data);

      const removed = await service.removeTestOverlay(created.data![0].id);

      expect(removed).toEqual({ success: true, data: [] });
    });

    it("rejects an empty name", async () => {
      expect(await service.createTestOverlay("   ")).toEqual({
        success: false,
      });
      expect(service.getTestOverlays()).toEqual([]);
    });

    it("sends every test payload to the id", () => {
      sendToClient.mockReturnValue(true);

      expect(service.sendTestEvents("dev")).toEqual({ success: true });

      const sent = sendToClient.mock.calls;
      expect(sent.every(([id]) => id === "dev")).toBe(true);
      expect(sent.map(([, p]) => p.type)).toEqual(
        service.getTestPayloads().map((p) => p.type),
      );
    });

    it("fails when no overlay is connected with the id", () => {
      expect(service.sendTestEvents("dev")).toEqual({ success: false });
    });
  });
});
