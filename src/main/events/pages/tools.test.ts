import { TimerSettingsSchema } from "@/common/schemas";
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

// The change is made, but the store file wasn't written.
const saveError = {
  code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
  message: "Tokio couldn't save the change. Check the logs folder for details.",
};

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
        saved: true,
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

    it("replies main's list, then reports a store that can't be saved", async () => {
      const h = createHandler({
        overlayService: {
          createTestOverlay: async () => ({
            success: true,
            saved: false,
            data: [scene, browser],
          }),
        },
      });

      await h.invoke(tools, APP_EVENTS.ADD_TEST_OVERLAY, { name: "Browser" });

      // The page ignores the failure reply and keeps the list.
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: true, data: [scene, browser] },
        { success: false, error: saveError },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...saveError }),
      ]);
    });
  });

  describe("REMOVE_TEST_OVERLAY", () => {
    it("replies the updated list and notifies", async () => {
      const removeTestOverlay = vi.fn(async () => ({
        success: true,
        saved: true,
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
          message: "Test overlay deleted.",
        }),
      ]);
    });

    it("replies main's list, then reports a store that can't be saved", async () => {
      const h = createHandler({
        overlayService: {
          removeTestOverlay: async () => ({
            success: true,
            saved: false,
            data: [browser],
          }),
        },
      });

      await h.invoke(tools, APP_EVENTS.REMOVE_TEST_OVERLAY, { id: "a1" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS)).toEqual([
        { success: true, data: [browser] },
        { success: false, error: saveError },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...saveError }),
      ]);
    });

    it("replies and notifies when it can't be removed", async () => {
      const h = createHandler({
        overlayService: {
          removeTestOverlay: async () => {
            throw new Error("Store not loaded");
          },
        },
      });

      await h.invoke(tools, APP_EVENTS.REMOVE_TEST_OVERLAY, { id: "a1" });

      const failure = {
        code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
        message: "Unable to delete the test overlay.",
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

  describe("countdown timer", () => {
    const state = { status: "running" as const, remaining: 90_000 };
    const settings = TimerSettingsSchema.parse({});
    const timerFailure = {
      code: FEEDBACK_CODES.TIMER_FAILED,
      message: "Unable to update the countdown timer.",
    };

    // The service's push answers the changes, they reply only failures
    const setup = (saved = true) => {
      const timerService = {
        get: vi.fn(() => ({ settings, state })),
        setSettings: vi.fn(),
        control: vi.fn(),
        adjust: vi.fn(),
        save: vi.fn(async () => saved),
      };
      return { h: createHandler({ timerService }), timerService };
    };

    it("replies the timer with nothing added", async () => {
      const { h } = setup();

      await h.invoke(tools, APP_EVENTS.GET_TIMER);

      expect(h.replies(APP_EVENTS_RESPONSE.TIMER)).toEqual([
        { success: true, data: { settings, state, added: 0 } },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("sets the settings, controls and adjusts the timer, saving each", async () => {
      const { h, timerService } = setup();

      await h.invoke(tools, APP_EVENTS.SET_TIMER_SETTINGS, { settings });
      await h.invoke(tools, APP_EVENTS.TIMER_CONTROL, { action: "pause" });
      await h.invoke(tools, APP_EVENTS.ADJUST_TIMER, { seconds: -300 });

      expect(timerService.setSettings).toHaveBeenCalledWith(settings);
      expect(timerService.control).toHaveBeenCalledWith("pause");
      expect(timerService.adjust).toHaveBeenCalledWith(-300_000);
      expect(timerService.save).toHaveBeenCalledTimes(3);
      expect(h.sent()).toEqual([]);
    });

    // What a page could send, whatever the types say
    const bad: [APP_EVENTS, any][] = [
      [APP_EVENTS.TIMER_CONTROL, { action: "explode" }],
      [APP_EVENTS.ADJUST_TIMER, { seconds: 0 }],
      [APP_EVENTS.ADJUST_TIMER, { seconds: Infinity }],
      [APP_EVENTS.ADJUST_TIMER, { seconds: "60" }],
    ];

    it.each(bad)("refuses %s with %o", async (event, data) => {
      const { h, timerService } = setup();

      await h.invoke(tools, event, data);

      expect(timerService.control).not.toHaveBeenCalled();
      expect(timerService.adjust).not.toHaveBeenCalled();
      expect(timerService.save).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.TIMER)).toEqual([
        { success: false, error: timerFailure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", source: "system" }),
      ]);
    });

    it("says so when the timer can't be saved", async () => {
      const { h, timerService } = setup(false);

      await h.invoke(tools, APP_EVENTS.TIMER_CONTROL, { action: "start" });

      expect(timerService.control).toHaveBeenCalledWith("start");
      expect(h.replies(APP_EVENTS_RESPONSE.TIMER)).toEqual([
        { success: false, error: saveError },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...saveError }),
      ]);
    });
  });
});
