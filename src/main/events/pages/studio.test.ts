import {
  StudioElementSchema,
  StudioGroupSchema,
  StudioOverlay,
  StudioOverlaySchema,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CameraCapture,
  CameraChunk,
  CameraFailure,
  FEEDBACK_CODES,
  STUDIO_MESSAGE,
  STUDIO_REACT_MESSAGE,
} from "@/common/types";
import Logger from "@/logger";
import { createHandler } from "@test/handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import studio from "./studio";

const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";
const SOCKET = `studio:${ID}`;

const overlay = (patch: Partial<StudioOverlay> = {}): StudioOverlay => ({
  id: ID,
  name: "Overlay 1",
  size: "portrait",
  rulers: false,
  guides: { x: [], y: [], locked: false },
  items: [],
  ...patch,
});

// The change is made, but the store file wasn't written.
const saveError = {
  code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
  message: "Tokio couldn't save the change. Check the logs folder for details.",
};

// What sending a view reads, besides the store
const viewServices = () => ({
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
  studioService: { kept: () => null, forget: vi.fn(), test: vi.fn() },
  serverService: { sendToClient: vi.fn((_id: string, _data: unknown) => true) },
});

// A store holding `held`, whose mutators answer `result`
const store = (
  held: StudioOverlay[],
  result: {
    add?: boolean | null;
    save?: boolean | null;
    remove?: boolean | null;
  } = {},
) => ({
  getStudio: () => held,
  getLiveStats: () => ({ likes: 0, viewers: 0, views: 0 }),
  addStudioOverlay: vi.fn(async (id: string, name: string) => {
    if (result.add === null) return null;
    held.push(overlay({ id, name }));
    return result.add ?? true;
  }),
  saveStudioOverlay: vi.fn(async (saved: unknown) => {
    if (result.save === null) return null;
    held.splice(0, 1, StudioOverlaySchema.parse(saved));
    return result.save ?? true;
  }),
  removeStudioOverlay: vi.fn(async (id: string) => {
    const index = held.findIndex((o) => o.id === id);
    if (index === -1) return null;
    held.splice(index, 1);
    return result.remove ?? true;
  }),
});

describe("studio events", () => {
  beforeEach(() => {
    vi.spyOn(Logger, "error").mockImplementation(() => {});
    vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  describe("GET_STUDIO", () => {
    it("replies every studio overlay, with no notice", async () => {
      const h = createHandler({ storeManagerService: store([overlay()]) });

      await h.invoke(studio, APP_EVENTS.GET_STUDIO);

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [overlay()] },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("ADD_STUDIO_OVERLAY", () => {
    it("adds it, replies the list and notifies", async () => {
      const storeManagerService = store([]);
      const h = createHandler({ storeManagerService });

      await h.invoke(studio, APP_EVENTS.ADD_STUDIO_OVERLAY, {
        id: ID,
        name: " Overlay 1 ",
      });

      expect(storeManagerService.addStudioOverlay).toHaveBeenCalledWith(
        ID,
        " Overlay 1 ",
      );
      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [overlay({ name: " Overlay 1 " })] },
      ]);
      expect(h.notices).toMatchObject([
        {
          level: "success",
          code: FEEDBACK_CODES.STUDIO_OVERLAY_ADDED,
          message: '"Overlay 1" created.',
        },
      ]);
    });

    it("keeps it when only the write failed, with no success notice", async () => {
      const h = createHandler({
        storeManagerService: store([], { add: false }),
      });

      await h.invoke(studio, APP_EVENTS.ADD_STUDIO_OVERLAY, {
        id: ID,
        name: "Overlay 1",
      });

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [overlay()] },
        { success: false, data: [overlay()], error: saveError },
      ]);
      expect(h.notices).toMatchObject([saveError]);
    });

    it("fails on an id that's taken or refused, replying the list", async () => {
      const held = [overlay()];
      const taken = createHandler({
        storeManagerService: store(held, { add: null }),
      });
      const refused = createHandler({
        storeManagerService: {
          ...store(held),
          addStudioOverlay: async () => {
            throw new Error("Not a UUID");
          },
        },
      });

      for (const h of [taken, refused]) {
        await h.invoke(studio, APP_EVENTS.ADD_STUDIO_OVERLAY, {
          id: ID,
          name: "Again",
        });

        const failure = {
          code: FEEDBACK_CODES.STUDIO_FAILED,
          message: "Unable to create the overlay.",
        };
        expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
          { success: false, data: [overlay()], error: failure },
        ]);
        expect(h.notices).toMatchObject([{ level: "error", ...failure }]);
      }
    });
  });

  describe("SAVE_STUDIO_OVERLAY", () => {
    const saved = overlay({
      name: "Main",
      items: [
        StudioGroupSchema.parse({
          kind: "group",
          id: "L1",
          elements: [
            StudioElementSchema.parse({
              id: "s",
              kind: "shape",
              x: 1,
              y: 2,
              width: 3,
              height: 4,
            }),
          ],
        }),
      ],
    });

    it("echoes the list and sends the view, with no notice", async () => {
      const services = viewServices();
      const h = createHandler({
        ...services,
        storeManagerService: store([overlay()]),
      });

      await h.invoke(studio, APP_EVENTS.SAVE_STUDIO_OVERLAY, {
        overlay: saved,
      });

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [saved] },
      ]);
      expect(services.serverService.sendToClient).toHaveBeenCalledWith(SOCKET, {
        type: STUDIO_MESSAGE,
        data: {
          view: {
            width: 1080,
            height: 1920,
            layers: [
              {
                id: "L1",
                z: 0,
                opacity: 1,
                elements: [
                  expect.objectContaining({ id: "s", kind: "shape", z: 0 }),
                ],
              },
            ],
          },
        },
      });
      expect(h.notices).toEqual([]);
    });

    it("still sends the view main holds when the write failed", async () => {
      const services = viewServices();
      const h = createHandler({
        ...services,
        storeManagerService: store([overlay()], { save: false }),
      });

      await h.invoke(studio, APP_EVENTS.SAVE_STUDIO_OVERLAY, {
        overlay: saved,
      });

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [saved] },
        { success: false, data: [saved], error: saveError },
      ]);
      expect(services.serverService.sendToClient).toHaveBeenCalledTimes(1);
      expect(h.notices).toMatchObject([saveError]);
    });

    it("fails on an overlay that was deleted, without a crash", async () => {
      const h = createHandler({
        storeManagerService: store([], { save: null }),
      });

      await h.invoke(studio, APP_EVENTS.SAVE_STUDIO_OVERLAY, {
        overlay: saved,
      });

      const failure = {
        code: FEEDBACK_CODES.STUDIO_FAILED,
        message: "This overlay no longer exists.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: false, data: [], error: failure },
      ]);
      expect(h.notices).toMatchObject([{ level: "warning", ...failure }]);
    });
  });

  describe("REMOVE_STUDIO_OVERLAY", () => {
    it("clears its page, forgets its elements and notifies", async () => {
      const services = viewServices();
      const h = createHandler({
        ...services,
        storeManagerService: store([overlay()]),
      });

      await h.invoke(studio, APP_EVENTS.REMOVE_STUDIO_OVERLAY, { id: ID });

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [] },
      ]);
      expect(services.serverService.sendToClient).toHaveBeenCalledWith(SOCKET, {
        type: STUDIO_MESSAGE,
        data: { view: null },
      });
      expect(services.studioService.forget).toHaveBeenCalledWith(ID);
      expect(h.notices).toMatchObject([
        {
          level: "success",
          code: FEEDBACK_CODES.STUDIO_OVERLAY_REMOVED,
          message: "Overlay deleted.",
        },
      ]);
    });

    it("keeps it removed when only the write failed, with no success notice", async () => {
      const services = viewServices();
      const h = createHandler({
        ...services,
        storeManagerService: store([overlay()], { remove: false }),
      });

      await h.invoke(studio, APP_EVENTS.REMOVE_STUDIO_OVERLAY, { id: ID });

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [] },
        { success: false, data: [], error: saveError },
      ]);
      expect(h.notices).toMatchObject([saveError]);
    });

    it("fails on an overlay main doesn't hold, replying the list", async () => {
      const services = viewServices();
      const h = createHandler({
        ...services,
        storeManagerService: store([overlay()]),
      });

      await h.invoke(studio, APP_EVENTS.REMOVE_STUDIO_OVERLAY, {
        id: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e",
      });

      const failure = {
        code: FEEDBACK_CODES.STUDIO_FAILED,
        message: "This overlay no longer exists.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: false, data: [overlay()], error: failure },
      ]);
      expect(h.notices).toMatchObject([{ level: "warning", ...failure }]);
    });
  });

  describe("TEST_STUDIO_OVERLAY", () => {
    it("plays the test's reacts on its page", async () => {
      const services = viewServices();
      const reacts = [{ element: "t", text: "Hi Ana" }, { element: "s" }];
      services.studioService.test.mockReturnValue(reacts);
      const h = createHandler({
        ...services,
        storeManagerService: store([overlay()]),
      });

      await h.invoke(studio, APP_EVENTS.TEST_STUDIO_OVERLAY, { id: ID });

      expect(services.studioService.test).toHaveBeenCalledWith(overlay(), {
        likes: 0,
        viewers: 0,
        followers: 0,
        shares: 0,
        coins: 0,
      });
      expect(services.serverService.sendToClient.mock.calls).toEqual(
        reacts.map((data) => [SOCKET, { type: STUDIO_REACT_MESSAGE, data }]),
      );
      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        { success: true, data: [overlay()] },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies the failure of an overlay that was deleted, with no notice", async () => {
      const h = createHandler({ storeManagerService: store([]) });

      await h.invoke(studio, APP_EVENTS.TEST_STUDIO_OVERLAY, { id: ID });

      expect(h.replies(APP_EVENTS_RESPONSE.STUDIO)).toEqual([
        {
          success: false,
          data: [],
          error: {
            code: FEEDBACK_CODES.STUDIO_FAILED,
            message: "This overlay no longer exists.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("cameras", () => {
    const capture = (patch: Partial<CameraCapture> = {}): CameraCapture => ({
      id: "1",
      device: "abc",
      label: "HD Webcam",
      quality: "720p",
      ...patch,
    });
    const cameras = (captures: CameraCapture[] = [capture()]) => {
      const serverService = {
        cameraCaptures: () => captures,
        cameraFrame: vi.fn((_chunk: CameraChunk) => {}),
      };
      const h = createHandler({
        serverService,
        pathManagerService: { files: { logs: { overlays: "overlays.log" } } },
      });
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {});
      return { h, serverService, warn };
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("replies the cameras to capture, with no notice", async () => {
      const { h } = cameras();

      await h.invoke(studio, APP_EVENTS.GET_CAMERAS);

      expect(h.replies(APP_EVENTS_RESPONSE.CAMERAS)).toEqual([
        { captures: [capture()] },
      ]);
      expect(h.notices).toEqual([]);
    });

    const config = {
      codec: "avc1.42001f",
      width: 1280,
      height: 720,
      description: new Uint8Array(7),
      colors: {
        primaries: "smpte170m",
        transfer: "smpte170m",
        matrix: "smpte170m",
        fullRange: false,
      },
    };
    const chunk = (patch: Record<string, unknown> = {}) => ({
      id: "1",
      key: true,
      timestamp: 33_333,
      frame: new Uint8Array([0, 0, 0, 1]),
      config,
      ...patch,
    });

    it("passes a chunk to the server", async () => {
      const { h, serverService } = cameras();
      const keyframe = chunk();
      const delta = chunk({ key: false, timestamp: -1.5, config: undefined });

      await h.invoke(studio, APP_EVENTS.CAMERA_FRAME, keyframe);
      await h.invoke(studio, APP_EVENTS.CAMERA_FRAME, delta);

      expect(serverService.cameraFrame.mock.calls).toEqual([
        [keyframe],
        [delta],
      ]);
      expect(h.notices).toEqual([]);
    });

    it("drops a chunk that isn't one, silently", async () => {
      const { h, serverService } = cameras();
      const bad: unknown[] = [
        chunk({ frame: new Uint8Array(0) }),
        chunk({ frame: new Uint8Array(4 * 1024 * 1024 + 1) }),
        chunk({ frame: "KEY" }),
        chunk({ frame: [0, 0, 0, 1] }),
        chunk({ id: 1 }),
        chunk({ key: 1 }),
        chunk({ key: undefined }),
        chunk({ timestamp: Number.NaN }),
        chunk({ timestamp: Number.POSITIVE_INFINITY }),
        chunk({ timestamp: "0" }),
        chunk({ config: null }),
        chunk({ config: "avc1.42001f" }),
        chunk({ config: { ...config, codec: "" } }),
        chunk({ config: { ...config, codec: "a".repeat(65) } }),
        chunk({ config: { ...config, codec: 'avc1"<x>' } }),
        chunk({ config: { ...config, codec: "avc1." } }),
        chunk({ config: { ...config, codec: `avc1.${"a".repeat(60)}` } }),
        chunk({ config: { ...config, codec: "vp09.00.10.08" } }),
        chunk({ config: { ...config, codec: "AVC1.42001f" } }),
        chunk({ config: { ...config, description: new Uint8Array(6) } }),
        chunk({ config: { ...config, description: new Uint8Array(1025) } }),
        chunk({ config: { ...config, description: [1, 2, 3, 4, 5, 6, 7] } }),
        chunk({ config: { ...config, description: undefined } }),
        chunk({ config: { ...config, codec: 1 } }),
        chunk({ config: { ...config, width: 0 } }),
        chunk({ config: { ...config, width: 1280.5 } }),
        chunk({ config: { ...config, height: 8193 } }),
        chunk({ config: { ...config, colors: undefined } }),
        chunk({ config: { ...config, colors: "smpte170m" } }),
        chunk({
          config: {
            ...config,
            colors: { ...config.colors, primaries: 'bt709"' },
          },
        }),
        chunk({
          config: { ...config, colors: { ...config.colors, fullRange: 0 } },
        }),
        chunk({ config: { codec: "vp8", width: 640 } }),
        undefined,
      ];

      for (const data of bad) {
        // A page could send anything
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        await h.invoke(studio, APP_EVENTS.CAMERA_FRAME, data as never);
      }
      await h.invoke(
        studio,
        APP_EVENTS.CAMERA_FRAME,
        chunk({
          frame: new Uint8Array(4 * 1024 * 1024),
          config: {
            codec: `avc1.${"a".repeat(59)}`,
            width: 8192,
            height: 1,
            description: new Uint8Array(1024),
            colors: null,
          },
        }),
      );

      expect(serverService.cameraFrame).toHaveBeenCalledTimes(1);
      expect(h.notices).toEqual([]);
    });

    it("warns that a camera failed once in 30 s, logging each notice", async () => {
      vi.useFakeTimers();
      const { h, warn } = cameras();

      for (let i = 0; i < 3; i++) {
        await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
          id: "1",
          reason: "busy",
        });
        vi.advanceTimersByTime(5000);
      }

      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "overlays",
          code: FEEDBACK_CODES.CAMERA_FAILED,
          message: "HD Webcam won't start. Another app may be using it.",
        }),
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        `<Studio> Unable to capture "HD Webcam" (busy)`,
        "overlays.log",
      );

      vi.advanceTimersByTime(30_000);
      await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
        id: "1",
        reason: "missing",
      });
      expect(h.notices.map((n) => n.message)).toEqual([
        "HD Webcam won't start. Another app may be using it.",
        "HD Webcam isn't connected.",
      ]);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("names the default camera, once in the window whatever the reason", async () => {
      const { h, warn } = cameras([capture({ device: "", label: "" })]);

      await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
        id: "1",
        reason: "blocked",
      });
      await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
        id: "1",
        reason: "failed",
      });

      expect(h.notices.map((n) => n.message)).toEqual([
        "Tokio isn't allowed to use cameras. Allow it in your system's privacy settings.",
      ]);
      expect(warn).toHaveBeenCalledWith(
        "<Studio> Unable to capture the default camera (blocked)",
        "overlays.log",
      );
    });

    it("keeps a window per camera", async () => {
      const { h } = cameras([
        capture(),
        capture({ id: "2", device: "def", label: "Capture card" }),
      ]);

      for (const id of ["1", "2"]) {
        await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
          id,
          reason: "failed",
        });
      }

      expect(h.notices.map((n) => n.message)).toEqual([
        "HD Webcam couldn't start.",
        "Capture card couldn't start.",
      ]);
    });

    it("ignores a capture main no longer holds, or an unknown reason", async () => {
      const { h, warn } = cameras();

      await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
        id: "2",
        reason: "busy",
      });
      await h.invoke(studio, APP_EVENTS.CAMERA_FAILED, {
        id: "1",
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        reason: "exploded" as CameraFailure,
      });

      expect(h.notices).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
