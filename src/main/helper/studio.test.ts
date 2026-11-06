import {
  StudioElementSchema,
  StudioLayerSchema,
  StudioOverlay,
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

// One layer holding the elements
const overlay = (
  id: string,
  elements: ReturnType<typeof element>[],
): StudioOverlay => ({
  id,
  name: "",
  size: "portrait",
  layers: [StudioLayerSchema.parse({ id: "L1", elements })],
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
    serverService: { sendToClient },
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
          layers: [{ id: "L1", z: 0, elements: [] }],
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
