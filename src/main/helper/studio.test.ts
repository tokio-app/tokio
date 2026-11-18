import {
  StudioElementSchema,
  StudioGroupSchema,
  StudioOverlay,
  TriggerSchema,
} from "@/common/schemas";
import { STUDIO_MESSAGE, StudioMessage, TOKIO_EVENTS } from "@/common/types";
import Logger from "@/logger";
import { StudioService } from "@/services/studio";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import {
  liveNumbers,
  sendStudioOverlay,
  sendStudioOverlays,
  showsNumbers,
  showsUptime,
  studioSampleView,
} from "./studio";

const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";
const OTHER = "7a2e3d2f-5c6b-4d4e-8f9a-1b2c3d4e5f60";

const element = (id: string, patch: object) =>
  StudioElementSchema.parse({
    id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...patch,
  });

// One group holding the elements
const overlay = (
  id: string,
  elements: ReturnType<typeof element>[],
): StudioOverlay => ({
  id,
  name: "",
  size: "portrait",
  rulers: false,
  guides: { x: [], y: [], locked: false },
  counters: [],
  items: [StudioGroupSchema.parse({ kind: "group", id: "L1", elements })],
});

const session = (startedAt: number | null) => ({
  startedAt,
  totals: { followers: 4, shares: 2, gifts: 9, coins: 1500 },
  activity: [],
});

const setup = (
  overlays: StudioOverlay[],
  {
    startedAt = 1,
    studio = new StudioService(),
  }: { startedAt?: number | null; studio?: StudioService } = {},
) => {
  const sendToClient = vi.fn((_id: string, _data: unknown) => true);
  const h = createHandler({
    storeManagerService: {
      getStudio: () => overlays,
      getLiveStats: () => ({ likes: 12_840, viewers: 30, views: 0 }),
    },
    liveService: { getSession: () => session(startedAt) },
    overlayService: {
      getGifts: async () => [
        { value: 1, label: "Rose", img: "tiktok-rose.png", coins: 1 },
      ],
      getCustomGifts: async () => [
        { value: 1, label: "Rose", img: "custom-rose.png", coins: 1 },
        { value: 2, label: "Mystery", img: "mystery.png", coins: 5 },
      ],
      getOverlays: () => [{ id: "gift jar" }],
    },
    serverService: { sendToClient, cameraKey: "k3y" },
    studioService: studio,
    pathManagerService: { files: { logs: { overlays: "overlays.log" } } },
  });
  const views = () =>
    sendToClient.mock.calls.map(([id, data]) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const { type, data: message } = data as {
        type: string;
        data: StudioMessage;
      };
      expect(type).toBe(STUDIO_MESSAGE);
      return [id, message.view] as const;
    });
  return { handler: h.handler, sendToClient, views };
};

describe("sendStudioOverlays", () => {
  it("sends each overlay's page its view, with the server's paths", async () => {
    const { handler, views } = setup([
      overlay(ID, [
        element("m", { kind: "media", file: "my clip.webm" }),
        element("g", { kind: "gift", gift: 1 }),
        element("c", { kind: "gift", gift: 2 }),
        element("i", {
          kind: "overlay",
          source: { type: "installed", id: "gift jar" },
        }),
        element("x", {
          kind: "overlay",
          source: { type: "installed", id: "removed" },
        }),
        element("a", { kind: "overlay", source: { type: "alert", id: "a/1" } }),
        element("t", { kind: "overlay", source: { type: "timer" } }),
        element("k", {
          kind: "overlay",
          source: { type: "games", column: null },
        }),
        element("2", { kind: "overlay", source: { type: "games", column: 2 } }),
      ]),
      overlay(OTHER, []),
    ]);

    await sendStudioOverlays(handler);

    const [[id, view], [other]] = views();
    expect(id).toBe(`studio:${ID}`);
    expect(other).toBe(`studio:${OTHER}`);
    expect(view?.width).toBe(1080);
    const elements = view?.layers[0].elements;
    expect(elements?.map((e) => ("src" in e ? e.src : null))).toEqual([
      "/alerts/media/my%20clip.webm",
      "tiktok-rose.png",
      "mystery.png",
      "/gift%20jar/",
      null,
      "/alerts/a%2F1/",
      "/timer/",
      "/games/minecraft/",
      // One column's page
      "/games/minecraft/2/",
    ]);
    expect(elements?.[0]).toMatchObject({ kind: "media", video: true });
  });

  it("streams a camera element from the server, under this run's key", async () => {
    const { handler, views } = setup([
      overlay(ID, [
        element("d", { kind: "camera" }),
        element("c", {
          kind: "camera",
          camera: { id: "abc", label: "HD Webcam" },
          quality: "1080p",
        }),
      ]),
    ]);

    await sendStudioOverlays(handler);

    const [[, view]] = views();
    expect(view?.layers[0].elements).toMatchObject([
      {
        kind: "camera",
        src: "/studio/camera/k3y?device=&label=&quality=720p",
      },
      {
        kind: "camera",
        src: "/studio/camera/k3y?device=abc&label=HD+Webcam&quality=1080p",
      },
    ]);
  });

  it("fills texts with the live numbers and each element's last event", async () => {
    const studio = new StudioService();
    const thanks = element("t", {
      kind: "text",
      when: "animate",
      text: "Last: {username} · {likes}",
    });
    const viewer = element("v", { kind: "viewer", when: "event" });
    const waiting = element("w", {
      kind: "text",
      when: "event",
      trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
      text: "[{username}] {coins} {followers}",
    });
    const always = element("a", { kind: "text", text: "{username} {viewers}" });
    const overlays = [overlay(ID, [thanks, viewer, waiting, always])];
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      {
        user: { username: "Ana", handle: "ana", profilePictures: ["ana.png"] },
      },
      overlays,
      () => liveNumbers(setup([]).handler),
    );
    const { handler, views } = setup(overlays, { studio });

    await sendStudioOverlays(handler);

    const [[, view]] = views();
    expect(view?.layers[0].elements).toMatchObject([
      { text: "Last: Ana · 12.8K" },
      { src: "ana.png", name: "Ana" },
      { text: "[] 1.5K 4" },
      { text: "{username} 30" },
    ]);
  });

  it("reads the session's totals as 0 while not LIVE", async () => {
    const { handler } = setup([], { startedAt: null });

    expect(liveNumbers(handler)).toEqual({
      likes: 12_840,
      viewers: 30,
      followers: 0,
      shares: 0,
      coins: 0,
      gifts: 0,
      uptime: 0,
    });
  });

  it("sends only the overlays it's asked for", async () => {
    const counts = overlay(ID, [
      element("t", { kind: "text", text: "{likes} likes" }),
    ]);
    const plain = overlay(OTHER, [element("t2", { kind: "text", text: "Hi" })]);
    const { handler, views } = setup([counts, plain]);

    await sendStudioOverlays(handler, showsNumbers);

    expect(views().map(([id]) => id)).toEqual([`studio:${ID}`]);
  });

  it("sends again the overlays whose texts show a number or a counter", () => {
    const text = (text: string) => [element("t", { kind: "text", text })];
    const counting = (text: string): StudioOverlay => ({
      ...overlay(ID, [element("t", { kind: "text", text })]),
      counters: [
        {
          name: "roses",
          trigger: TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] }),
        },
      ],
    });

    expect(showsNumbers(overlay(ID, text("{gifts} gifts")))).toBe(true);
    expect(showsNumbers(counting("{roses} roses"))).toBe(true);
    expect(showsNumbers(counting("roses"))).toBe(false);
    // Another overlay's counter isn't one
    expect(showsNumbers(overlay(ID, text("{roses} roses")))).toBe(false);
    // Goal bars and lists follow the LIVE whatever they show
    expect(showsNumbers(overlay(ID, [element("b", { kind: "bar" })]))).toBe(
      true,
    );
    expect(showsNumbers(overlay(ID, [element("l", { kind: "list" })]))).toBe(
      true,
    );
  });

  it("fills a goal bar toward its goal from the LIVE's number or a counter", async () => {
    const studio = new StudioService();
    const roses = TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] });
    const bars: StudioOverlay = {
      ...overlay(ID, [
        element("likes", { kind: "bar", number: "likes", goal: 25_680 }),
        element("roses", { kind: "bar", number: "roses", goal: 4 }),
        element("gone", { kind: "bar", number: "lilies", goal: 4 }),
      ]),
      counters: [{ name: "roses", trigger: roses }],
    };
    studio.handle(
      TOKIO_EVENTS.GIFT,
      {
        user: { username: "Ana", handle: "ana", profilePictures: [] },
        gift: {
          id: "5655",
          name: "Rose",
          coins: 1,
          type: 1,
          comboCount: 3,
          repeatEnd: true,
          image: "rose.png",
        },
      },
      [bars],
      () => liveNumbers(setup([]).handler),
    );
    const { handler, views } = setup([bars], { studio });

    await sendStudioOverlays(handler);

    const [[, view]] = views();
    expect(view?.layers[0].elements).toMatchObject([
      { fill: 0.5 },
      { fill: 0.75 },
      { fill: 0 },
    ]);
  });

  it("finds the overlays whose texts show the LIVE's length", () => {
    const uptime = overlay(ID, [
      element("t", { kind: "text", text: "Live for {uptime}" }),
    ]);
    const likes = overlay(ID, [
      element("t", { kind: "text", text: "{likes}" }),
    ]);

    expect(showsUptime(uptime)).toBe(true);
    expect(showsUptime(likes)).toBe(false);
  });

  it("sends one overlay, or null when it's gone", async () => {
    const { handler, views } = setup([overlay(ID, []), overlay(OTHER, [])]);

    await sendStudioOverlay(handler, OTHER);
    await sendStudioOverlay(handler, "gone");

    expect(views()).toEqual([
      [
        `studio:${OTHER}`,
        {
          width: 1080,
          height: 1920,
          layers: [
            {
              id: "L1",
              z: 0,
              opacity: 1,
              group: {
                when: "always",
                seconds: 5,
                entrance: "pop",
                exit: "fade",
                animation: "bounce",
                idle: "float",
              },
              elements: [],
            },
          ],
        },
      ],
      ["studio:gone", null],
    ]);
  });

  it("logs a failure instead of throwing", async () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => {});
    const { handler, sendToClient } = setup([overlay(ID, [])]);
    handler.overlayService.getGifts = async () => {
      throw new Error("gone");
    };

    await expect(sendStudioOverlays(handler)).resolves.toBeUndefined();

    expect(sendToClient).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("<Studio>"),
      "overlays.log",
      expect.any(Error),
    );
  });
});

describe("studioSampleView", () => {
  it("shows Test's samples with the server's paths and no camera", async () => {
    const { handler } = setup([]);
    const trigger = { type: TOKIO_EVENTS.FOLLOW, gifts: [] };
    const gift = { type: TOKIO_EVENTS.GIFT, gifts: [] };

    const view = await studioSampleView(
      handler,
      overlay(ID, [
        element("t", {
          kind: "text",
          text: "{username} {likes}",
          when: "event",
          trigger,
        }),
        element("v", { kind: "viewer", when: "event", trigger }),
        element("g", {
          kind: "gift",
          gift: null,
          when: "event",
          trigger: gift,
        }),
        element("r", { kind: "gift", gift: 2 }),
        element("m", { kind: "media", file: "a.png" }),
        element("c", { kind: "camera" }),
        element("i", {
          kind: "overlay",
          source: { type: "installed", id: "gift jar" },
        }),
      ]),
    );

    const [text, viewer, sent, picked, media, camera, embed] =
      view.layers[0].elements;
    expect(viewer).toMatchObject({ kind: "viewer", src: /^https:/ });
    const name = viewer.kind === "viewer" ? viewer.name : "";
    expect(name).not.toBe("");
    // The live numbers' samples, and the follow's own viewer
    expect(text).toMatchObject({ text: `${name} 12.8K` });
    expect(sent).toMatchObject({ src: /^https:/ });
    expect(picked).toMatchObject({ src: "mystery.png" });
    expect(media).toMatchObject({ src: "/alerts/media/a.png" });
    expect(camera).toMatchObject({ kind: "camera", src: null });
    expect(embed).toMatchObject({ src: "/gift%20jar/", label: "" });
  });
});
