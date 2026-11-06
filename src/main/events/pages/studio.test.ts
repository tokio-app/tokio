import {
  StudioLayerSchema,
  StudioOverlay,
  StudioOverlaySchema,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  STUDIO_MESSAGE,
  STUDIO_REACT_MESSAGE,
} from "@/common/types";
import Logger from "@/logger";
import { createHandler } from "@test/handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import studio from "./studio";

const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";
const SOCKET = `studio:${ID}`;

const overlay = (patch: Partial<StudioOverlay> = {}): StudioOverlay => ({
  id: ID,
  name: "Overlay 1",
  size: "portrait",
  layers: [],
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
    remove?: boolean;
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
    held.splice(
      held.findIndex((o) => o.id === id),
      1,
    );
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
          message: 'Overlay "Overlay 1" added.',
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
          message: "Unable to add the overlay.",
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
      layers: [
        StudioLayerSchema.parse({
          id: "s",
          kind: "shape",
          x: 1,
          y: 2,
          width: 3,
          height: 4,
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
            layers: [expect.objectContaining({ id: "s", kind: "shape", z: 0 })],
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
    it("clears its page, forgets its layers and notifies", async () => {
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
  });

  describe("TEST_STUDIO_OVERLAY", () => {
    it("plays the test's reacts on its page", async () => {
      const services = viewServices();
      const reacts = [{ layer: "t", text: "Hi Ana" }, { layer: "s" }];
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
});
