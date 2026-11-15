import type { Alert, Profile } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import { createAlert, defaultProfile, getAlertOverlayURL } from "@/common/util";
import alerts from "@/events/pages/alerts";
import { t } from "@/helper/i18n";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const alert = (changes: Partial<Alert> = {}): Alert => ({
  ...createAlert(0),
  id: "a1",
  name: "Follows",
  sound: { name: "Horn", file: "horn.mp3", start: 1, end: 2 },
  ...changes,
});

function setup(items: Alert[] = [alert()]) {
  const profile: Profile = structuredClone({
    ...defaultProfile,
    alerts: { simultaneous: false, queue_length: 10, items },
    emotes: [
      { id: "7001", image: "https://example.com/1.png" },
      { id: "7002", image: "https://example.com/2.png" },
    ],
  });
  const sounds = [
    { name: "Horn", file: "horn.mp3" },
    { name: "Bell", file: "bell.mp3" },
  ];
  const media = [{ name: "Party", file: "party.png" }];
  const pictures = [{ name: "Creeper", file: "creeper.png" }];
  const settings = { activeProfile: { name: "Main", file: "main.json" } };
  const updateProfileData = vi.fn(async (data: Partial<Profile>) => {
    Object.assign(profile, data);
    return true;
  });
  const addFiles = (list: typeof sounds) =>
    vi.fn(async (files: typeof sounds) => {
      for (const f of files) {
        if (!list.some((s) => s.file === f.file)) list.push(f);
      }
      return true;
    });
  const storeManagerService = {
    getSettings: () => settings,
    getProfiles: () => [settings.activeProfile],
    getProfileData: async () => profile,
    updateProfileData,
    getSounds: () => sounds,
    getMedia: () => media,
    getMinecraftPictures: () => pictures,
    addSounds: addFiles(sounds),
    addMediaFiles: addFiles(media),
    addSound: async (s: (typeof sounds)[number]) => {
      sounds.push(s);
      return true;
    },
    addMinecraftPicture: async (p: (typeof pictures)[number]) => {
      pictures.push(p);
      return true;
    },
    removeSound: vi.fn(async (file: string) => {
      sounds.splice(
        sounds.findIndex((s) => s.file === file),
        1,
      );
      return true;
    }),
    removeFromAlerts: vi.fn(async () => true),
  };
  const alertsService = {
    readSound: vi.fn(
      async (): Promise<{
        success: boolean;
        data?: Uint8Array;
        error?: string;
      }> => ({
        success: true,
        data: new Uint8Array([1, 2]),
      }),
    ),
    fetchSound: vi.fn(async () => ({
      success: true,
      data: new Uint8Array([3]),
    })),
    speak: vi.fn(async () => ({ success: true, data: new Uint8Array([4]) })),
    deleteSound: vi.fn(async () => ({ success: true })),
    importSound: vi.fn(async () => ({
      success: true,
      data: { name: "clip", file: "abc.mp3" },
    })),
    importMedia: vi.fn(async () => ({
      success: true,
      data: { name: "clip", file: "abc.webm" },
    })),
    downloadSound: vi.fn(async (_url: string, name: string) => ({
      success: true,
      data: { name, file: "dl.mp3" },
    })),
    search: vi.fn(async () => ({
      success: true,
      data: {
        sounds: [
          {
            name: "Bruh",
            url: "https://www.myinstants.com/b.mp3",
            file: "b.mp3",
          },
        ],
        hasNextPage: true,
      },
    })),
    getTrending: vi.fn(async () => ({
      success: true,
      data: { sounds: [], hasNextPage: false },
    })),
  };
  const gamesService = {
    importPicture: vi.fn(async () => ({
      success: true,
      data: { name: "pig", file: "pig.png" },
    })),
  };
  const overlayService = {
    getGifts: async () => [
      { value: 2, label: "Rose", img: "r.png", coins: 1 },
      { value: 1, label: "Lion", img: "l.png", coins: 29999 },
    ],
    getCustomGifts: async () => [
      { value: 2, label: "Rose", img: "r.png", coins: 1 },
      { value: 3, label: "Heart", img: "h.png", coins: 5 },
    ],
  };
  const h = createHandler(
    {
      storeManagerService,
      alertsService,
      gamesService,
      overlayService,
    },
    { stack: alerts },
  );
  return {
    h,
    profile,
    sounds,
    pictures,
    updateProfileData,
    storeManagerService,
    alertsService,
    gamesService,
  };
}

describe("alerts MCP tools", () => {
  describe("the alerts section", () => {
    it("reads it without the items", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("get_settings", { section: "alerts" })).value).toEqual(
        { values: { simultaneous: false, queue_length: 10 } },
      );
    });

    it("saves the change with the stored items, then sends the profile", async () => {
      const s = setup();
      const invoke = vi.spyOn(s.h.handler, "invoke");
      const { call } = await mcpClient(s.h.handler);

      const res = await call("update_settings", {
        section: "alerts",
        changes: { simultaneous: true },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      expect(invoke).toHaveBeenCalledExactlyOnceWith(
        APP_EVENTS.UPDATE_ALERTS_SETTINGS,
        {
          settings: {
            simultaneous: true,
            queue_length: 10,
            items: [alert()],
          },
        },
      );
      expect(s.h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
    });

    it("refuses the items", async () => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      const res = await call("update_settings", {
        section: "alerts",
        changes: { items: [] },
      });

      expect(res.isError).toBe(true);
      expect(s.updateProfileData).not.toHaveBeenCalled();
    });
  });

  describe("alert", () => {
    it("lists the alerts with their triggers' filters", async () => {
      const { h } = setup([
        alert(),
        alert({
          id: "a2",
          name: "Roses",
          sound: null,
          media: {
            name: "Party",
            file: "party.png",
            start: 0,
            end: null,
            duration: 5,
            volume: 100,
          },
          trigger: {
            ...createAlert().trigger,
            type: TOKIO_EVENTS.GIFT,
            gifts: [2],
          },
        }),
      ]);
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("list", { kind: "alert", query: "rose" })).value,
      ).toEqual({
        total: 1,
        alerts: [
          {
            id: "a2",
            name: "Roses",
            enabled: true,
            trigger: { type: TOKIO_EVENTS.GIFT, gifts: [2] },
            sound: null,
            message: null,
            media: { name: "Party", file: "party.png" },
          },
        ],
      });
    });

    it("gets one with its overlay's URL", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("get", { kind: "alert", id: "a1" })).value).toEqual({
        ...alert(),
        overlayURL: getAlertOverlayURL("a1"),
      });
      expect((await call("get", { kind: "alert", id: "nope" })).isError).toBe(
        true,
      );
    });

    it("creates one from the defaults, its sound named by the library", async () => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      const res = await call("save_item", {
        kind: "alert",
        changes: {
          name: "",
          trigger: { type: TOKIO_EVENTS.SHARE },
          sound: { file: "bell.mp3" },
        },
      });

      expect(res.isError).toBe(false);
      const created = s.profile.alerts.items[1];
      expect(res.value).toEqual({
        id: created.id,
        overlayURL: getAlertOverlayURL(created.id),
      });
      expect(created).toMatchObject({
        name: "",
        enabled: true,
        trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
        sound: { name: "Bell", file: "bell.mp3", start: 0, end: null },
      });
      expect(s.h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
    });

    it("keeps the cut for the same sound and drops it for another", async () => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      await call("save_item", {
        kind: "alert",
        id: "a1",
        changes: { sound: { end: 3 } },
      });
      expect(s.profile.alerts.items[0].sound).toEqual({
        name: "Horn",
        file: "horn.mp3",
        start: 1,
        end: 3,
      });

      await call("save_item", {
        kind: "alert",
        id: "a1",
        changes: { sound: { file: "bell.mp3" } },
      });
      expect(s.profile.alerts.items[0].sound).toEqual({
        name: "Bell",
        file: "bell.mp3",
        start: 0,
        end: null,
      });
    });

    it.each([
      ["a sound not in the library", { sound: { file: "gone.mp3" } }],
      ["media not in the library", { media: { file: "gone.png" } }],
      ["an invalid value", { volume: 500 }],
      ["a new id", { id: "a9" }],
      ["an unknown field", { color: "red" }],
    ])("refuses %s", async (_, changes) => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      const res = await call("save_item", { kind: "alert", id: "a1", changes });

      expect(res.isError).toBe(true);
      expect(s.updateProfileData).not.toHaveBeenCalled();
    });

    it("refuses an alert it doesn't have", async () => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      const res = await call("save_item", {
        kind: "alert",
        id: "nope",
        changes: { enabled: false },
      });

      expect(res.isError).toBe(true);
    });

    it("refuses a save when the profile switched meanwhile", async () => {
      const s = setup();
      let reads = 0;
      s.storeManagerService.getSettings = () => ({
        activeProfile: {
          name: "Main",
          file: reads++ ? "other.json" : "main.json",
        },
      });
      const { call } = await mcpClient(s.h.handler);

      const res = await call("save_item", {
        kind: "alert",
        id: "a1",
        changes: { enabled: false },
      });

      expect(res.isError).toBe(true);
      expect(s.updateProfileData).not.toHaveBeenCalled();
    });

    it("removes one", async () => {
      const s = setup([alert(), alert({ id: "a2" })]);
      const { call } = await mcpClient(s.h.handler);

      expect((await call("remove", { kind: "alert", id: "a1" })).isError).toBe(
        false,
      );
      expect(s.profile.alerts.items.map((a) => a.id)).toEqual(["a2"]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
    });

    it("tests its sound on the test queue, with its cut and media", async () => {
      const media = {
        name: "Party",
        file: "party.png",
        start: 0,
        end: null,
        duration: 5,
        volume: 100,
      };
      const s = setup([alert({ media, volume: 70 })]);
      const { call } = await mcpClient(s.h.handler);

      const res = await call("test", { kind: "alert", id: "a1" });

      expect(res.isError).toBe(false);
      expect(s.alertsService.readSound).toHaveBeenCalledWith("horn.mp3");
      expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([
        {
          id: "a1",
          volume: 70,
          media,
          data: new Uint8Array([1, 2]),
          key: "horn.mp3",
          start: 1,
          end: 2,
          channel: "alert-test",
          maxQueueLength: 10,
        },
      ]);
      // Private: the page's own tests never see it
      expect(s.h.pushed(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([]);
    });

    it("tests its message with its speed and pitch", async () => {
      const tts = {
        voice: { engine: "edge", name: "Ana", lang: "es", id: "ana" },
        message: "Gracias {username}",
        speed: 1.5,
        pitch: 0.8,
      };
      const s = setup([alert({ tts })]);
      const { call } = await mcpClient(s.h.handler);

      await call("test", { kind: "alert", id: "a1" });

      expect(s.alertsService.speak).toHaveBeenCalledOnce();
      expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([
        expect.objectContaining({
          data: new Uint8Array([4]),
          filters: { speed: 1.5, pitch: 0.8 },
          channel: "alert-test",
        }),
      ]);
    });

    it("shows media alone without asking for audio", async () => {
      const media = {
        name: "Party",
        file: "party.png",
        start: 0,
        end: null,
        duration: 5,
        volume: 100,
      };
      const s = setup([alert({ sound: null, media })]);
      const { call } = await mcpClient(s.h.handler);

      await call("test", { kind: "alert", id: "a1" });

      expect(s.alertsService.readSound).not.toHaveBeenCalled();
      expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([
        {
          id: "a1",
          volume: 100,
          media,
          channel: "alert-test",
          maxQueueLength: 10,
        },
      ]);
    });

    it("gives the handler's message when the sound can't be read", async () => {
      const s = setup();
      s.alertsService.readSound.mockResolvedValue({
        success: false,
        error: "gone",
      });
      const { call } = await mcpClient(s.h.handler);

      const res = await call("test", { kind: "alert", id: "a1" });

      expect(res).toMatchObject({ isError: true });
      expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([]);
    });
  });

  describe("sounds and media", () => {
    it("lists the libraries newest first", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("list", { kind: "sounds" })).value).toEqual({
        total: 2,
        sounds: [
          { id: "bell.mp3", name: "Bell" },
          { id: "horn.mp3", name: "Horn" },
        ],
      });
      expect((await call("list", { kind: "media" })).value).toEqual({
        total: 1,
        media: [{ id: "party.png", name: "Party" }],
      });
    });

    it("removes a sound through REMOVE_SOUND", async () => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      const res = await call("remove", { kind: "sounds", id: "horn.mp3" });

      expect(res.isError).toBe(false);
      expect(s.storeManagerService.removeFromAlerts).toHaveBeenCalledWith(
        "sound",
        "horn.mp3",
      );
      expect(s.h.pushed(APP_EVENTS_RESPONSE.GET_SOUNDS)).toHaveLength(1);
      expect(
        (await call("remove", { kind: "sounds", id: "horn.mp3" })).isError,
      ).toBe(true);
    });

    it("tests a library sound or a MyInstants url", async () => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      await call("test", { kind: "sounds", id: "bell.mp3" });
      const url = "https://www.myinstants.com/b.mp3";
      await call("test", { kind: "sounds", args: { url } });

      expect(s.alertsService.fetchSound).toHaveBeenCalledWith(url);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([
        expect.objectContaining({ id: "bell.mp3", key: "bell.mp3" }),
        expect.objectContaining({ id: url, data: new Uint8Array([3]) }),
      ]);
      expect((await call("test", { kind: "sounds" })).isError).toBe(true);
    });
  });

  describe("add_to_library", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "tokio-mcp-"));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("adds a sound from a path, then lists it and notifies", async () => {
      const s = setup();
      const path = join(dir, "clip.mp3");
      await writeFile(path, "x");
      const { call } = await mcpClient(s.h.handler);

      const res = await call("add_to_library", { kind: "sound", path });

      expect(res.value).toEqual({ id: "abc.mp3", name: "clip", new: true });
      expect(s.alertsService.importSound).toHaveBeenCalledWith(path);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([
        {
          success: true,
          data: expect.arrayContaining([{ name: "clip", file: "abc.mp3" }]),
        },
      ]);
      expect(s.h.notices.at(-1)).toMatchObject({
        code: FEEDBACK_CODES.SOUND_ADDED,
        message: t("main.alerts.soundAdded", { name: "clip" }),
      });
    });

    it("adds a Minecraft picture from a path", async () => {
      const s = setup();
      const path = join(dir, "pig.png");
      await writeFile(path, "x");
      const { call } = await mcpClient(s.h.handler);

      const res = await call("add_to_library", {
        kind: "minecraft_picture",
        path,
      });

      expect(res.value).toEqual({ id: "pig.png", name: "pig" });
      expect(s.h.pushed(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES)).toHaveLength(
        1,
      );
      expect(s.h.notices.at(-1)?.code).toBe(FEEDBACK_CODES.GAME_PICTURES_ADDED);
    });

    it("downloads a MyInstants sound through DOWNLOAD_SOUND", async () => {
      const s = setup();
      const invoke = vi.spyOn(s.h.handler, "invoke");
      const { call } = await mcpClient(s.h.handler);
      const url = "https://www.myinstants.com/media/sounds/bruh.mp3";

      const res = await call("add_to_library", {
        kind: "sound",
        url,
        name: "Bruh",
      });

      expect(res.value).toEqual({ id: "dl.mp3", name: "Bruh" });
      expect(invoke).toHaveBeenCalledWith(APP_EVENTS.DOWNLOAD_SOUND, {
        id: "",
        request: 0,
        url,
        name: "Bruh",
      });
      expect(s.h.pushed(APP_EVENTS_RESPONSE.GET_SOUNDS)).toHaveLength(1);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.SET_ALERT_SOUND)).toEqual([]);
    });

    it.each([
      ["a network path", { kind: "sound", path: "\\\\server\\share\\a.mp3" }],
      ["a relative path", { kind: "sound", path: "a.mp3" }],
      [
        "a url for media",
        { kind: "media", url: "https://x.y/a.png", name: "a" },
      ],
      ["both", { kind: "sound", url: "https://x.y/a.mp3", path: "C:\\a.mp3" }],
      ["neither", { kind: "sound" }],
    ])("refuses %s", async (_, args) => {
      const s = setup();
      const { call } = await mcpClient(s.h.handler);

      expect((await call("add_to_library", args)).isError).toBe(true);
      expect(s.alertsService.importSound).not.toHaveBeenCalled();
      expect(s.alertsService.downloadSound).not.toHaveBeenCalled();
    });
  });

  it("searches MyInstants, trending without a query", async () => {
    const s = setup();
    const { call } = await mcpClient(s.h.handler);

    expect((await call("search_sounds", { query: " bruh " })).value).toEqual({
      page: 1,
      hasNextPage: true,
      sounds: [{ name: "Bruh", url: "https://www.myinstants.com/b.mp3" }],
    });
    expect(s.alertsService.search).toHaveBeenCalledWith("bruh", 1);
    await call("search_sounds", { page: 2 });
    expect(s.alertsService.getTrending).toHaveBeenCalledWith(2);
  });

  it("lists TikTok's gifts and the custom ones, cheapest first", async () => {
    const { h } = setup();
    const { call } = await mcpClient(h.handler);

    expect((await call("list", { kind: "gifts" })).value).toEqual({
      total: 3,
      gifts: [
        { id: 2, name: "Rose", coins: 1 },
        { id: 3, name: "Heart", coins: 5 },
        { id: 1, name: "Lion", coins: 29999 },
      ],
    });
  });

  it("lists the profile's emotes without their pictures", async () => {
    const { h } = setup();
    const { call } = await mcpClient(h.handler);

    expect((await call("list", { kind: "emotes", limit: 1 })).value).toEqual({
      total: 2,
      emotes: [{ id: "7001" }],
    });
  });
});
