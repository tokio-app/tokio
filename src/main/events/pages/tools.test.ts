import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import tools from "./tools";

const scene = { id: "a1", name: "Scene" };
const browser = { id: "b2", name: "Browser" };

describe("tools events", () => {
  describe("GET_TEST_OVERLAYS", () => {
    it("replies the test overlays", async () => {
      const h = createHandler({
        overlayService: { getTestOverlays: () => [scene, browser] },
      });

      await h.invoke(tools, APP_EVENTS.GET_TEST_OVERLAYS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: true, data: [scene, browser] },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("ADD_TEST_OVERLAY", () => {
    it("replies the updated list and notifies with the trimmed name", async () => {
      const createTestOverlay = vi.fn(async () => ({
        success: true,
        data: [scene, browser],
      }));
      const h = createHandler({ overlayService: { createTestOverlay } });

      await h.invoke(tools, APP_EVENTS.ADD_TEST_OVERLAY, {
        name: "  Browser ",
      });

      expect(createTestOverlay).toHaveBeenCalledWith("  Browser ");
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: true, data: [scene, browser] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "overlays",
          code: FEEDBACK_CODES.TEST_OVERLAY_ADDED,
          message: 'Test overlay "Browser" added.',
        }),
      ]);
    });

    it("replies and notifies when it isn't added", async () => {
      const h = createHandler({
        overlayService: { createTestOverlay: async () => ({ success: false }) },
      });

      await h.invoke(tools, APP_EVENTS.ADD_TEST_OVERLAY, { name: " " });

      const failure = {
        code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
        message: "Unable to add the test overlay.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          source: "overlays",
          ...failure,
        }),
      ]);
    });
  });

  describe("REMOVE_TEST_OVERLAY", () => {
    it("replies the updated list and notifies", async () => {
      const removeTestOverlay = vi.fn(async () => ({
        success: true,
        data: [browser],
      }));
      const h = createHandler({ overlayService: { removeTestOverlay } });

      await h.invoke(tools, APP_EVENTS.REMOVE_TEST_OVERLAY, { id: "a1" });

      expect(removeTestOverlay).toHaveBeenCalledWith("a1");
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: true, data: [browser] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.TEST_OVERLAY_REMOVED,
          message: "Test overlay removed.",
        }),
      ]);
    });

    it("replies and notifies when it can't be removed", async () => {
      const h = createHandler({
        overlayService: {
          removeTestOverlay: async () => ({ success: false, data: [scene] }),
        },
      });

      await h.invoke(tools, APP_EVENTS.REMOVE_TEST_OVERLAY, { id: "a1" });

      const failure = {
        code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
        message: "Unable to remove the test overlay.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("SEND_TEST_EVENTS", () => {
    it.each([true, false])(
      "replies success: %s from the service with the id",
      async (success) => {
        const sendTestEvents = vi.fn(() => ({ success }));
        const h = createHandler({ overlayService: { sendTestEvents } });

        await h.invoke(tools, APP_EVENTS.SEND_TEST_EVENTS, { id: "a1" });

        expect(sendTestEvents).toHaveBeenCalledWith("a1");
        expect(h.replies(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS)).toEqual([
          { id: "a1", success },
        ]);
        expect(h.notices).toEqual([]);
      },
    );

    it("replies a failure with the id, without a notice", async () => {
      const h = createHandler({
        overlayService: {
          sendTestEvents: () => {
            throw new Error("server off");
          },
        },
      });

      await h.invoke(tools, APP_EVENTS.SEND_TEST_EVENTS, { id: "a1" });

      expect(h.replies(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS)).toEqual([
        {
          id: "a1",
          success: false,
          error: {
            code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
            message: "Unable to send the test events.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
    });
  });
});
