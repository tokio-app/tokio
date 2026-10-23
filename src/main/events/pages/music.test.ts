import { Profile } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import { defaultProfile } from "@/common/util";
import { describe, expect, it, vi } from "vitest";

// music.ts keeps the last connect's listener, so every test gets a fresh
// copy, and the helpers and Logger from the same modules, or the notifier
// wouldn't recognize its AppFailures.
async function load() {
  vi.resetModules();
  const [
    { default: music },
    { createHandler, eventSource },
    { default: Logger },
  ] = await Promise.all([
    import("./music"),
    import("@test/handler"),
    import("@/logger"),
  ]);
  const logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
  return { music, createHandler, eventSource, logError };
}

const settings: Profile["music"] = defaultProfile.music;

describe("music events", () => {
  describe("UPDATE_MUSIC_SETTINGS", () => {
    it("saves the settings without a notice, since it's an autosave", async () => {
      const { music, createHandler } = await load();
      const updateProfileData = vi.fn(async (_data: Partial<Profile>) => true);
      const h = createHandler({ storeManagerService: { updateProfileData } });

      await h.invoke(music, APP_EVENTS.UPDATE_MUSIC_SETTINGS, { settings });

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith({
        music: settings,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("reports a failed save as the system's, logged once by the store", async () => {
      const { music, createHandler, logError } = await load();
      const h = createHandler({
        storeManagerService: { updateProfileData: async () => false },
      });

      await h.invoke(music, APP_EVENTS.UPDATE_MUSIC_SETTINGS, { settings });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
        message: "Unable to save the music settings.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          source: "system",
          ...failure,
        }),
      ]);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("CONNECT_MUSIC", () => {
    const setup = async (connects = true) => {
      const m = await load();
      const events = m.eventSource();
      const musicService = {
        ...events,
        disconnect: vi.fn(),
        clearHandler: vi.fn(),
        setProvider: vi.fn((_name: string, _key?: string) => {}),
        connect: vi.fn(
          async (): Promise<{ success: boolean; error?: Error }> =>
            connects
              ? { success: true }
              : { success: false, error: new Error("window closed") },
        ),
      };
      const h = m.createHandler({ musicService });
      const connect = (name = "Spotify", key = "client-id") =>
        h.invoke(m.music, APP_EVENTS.CONNECT_MUSIC, { name, key });
      const ended = () =>
        events.emit(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, undefined);
      const connected = () => h.replies(APP_EVENTS_RESPONSE.MUSIC_CONNECTED);
      return { ...m, h, events, musicService, connect, ended, connected };
    };

    it("sets the provider with its key and connects", async () => {
      const { h, musicService, connect, connected } = await setup();

      await connect("Spotify", "client-id");

      expect(musicService.setProvider).toHaveBeenCalledExactlyOnceWith(
        "Spotify",
        "client-id",
      );
      expect(musicService.connect).toHaveBeenCalledOnce();
      expect(connected()).toEqual([{ success: true }]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "music",
          code: FEEDBACK_CODES.MUSIC_CONNECTED,
          message: "Connected to Spotify.",
        }),
      ]);
    });

    it("disconnects the last provider first, without hearing it end", async () => {
      const { h, musicService, connect, ended, connected } = await setup();
      await connect("Spotify");
      // Like closing a session, or a login still open
      musicService.disconnect.mockImplementation(ended);

      await connect("YouTube");

      expect(musicService.disconnect).toHaveBeenCalledTimes(2);
      expect(musicService.disconnect.mock.invocationCallOrder[1]).toBeLessThan(
        musicService.setProvider.mock.invocationCallOrder[1],
      );
      // Spotify's listener was gone before its session ended
      expect(connected()).toEqual([{ success: true }, { success: true }]);
      expect(h.notices.map((n) => n.code)).not.toContain(
        FEEDBACK_CODES.MUSIC_DISCONNECTED,
      );
    });

    it("drops the result of a connect a newer one replaced", async () => {
      const { h, musicService, connect, connected } = await setup();
      let finish = (_res: { success: boolean; error?: Error }) => {};
      musicService.connect.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );

      const first = connect("YouTube");
      await connect("Spotify");
      // Its window was closed by the second connect
      finish({ success: false, error: new Error("window closed") });
      await first;

      expect(connected()).toEqual([{ success: true }]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          code: FEEDBACK_CODES.MUSIC_CONNECTED,
          message: "Connected to Spotify.",
        }),
      ]);
    });

    it("replies a failure when it can't connect", async () => {
      const { h, connect, connected, logError } = await setup(false);

      await connect("YouTube");

      const failure = {
        code: FEEDBACK_CODES.MUSIC_CONNECT_FAILED,
        message: "Unable to connect to YouTube.",
      };
      expect(connected()).toEqual([{ success: false, error: failure }]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          source: "music",
          ...failure,
        }),
      ]);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("window closed"),
        undefined,
        expect.any(Error),
      );
    });

    it("says it disconnected once when the provider ends after connecting", async () => {
      const { h, connect, ended, connected } = await setup();
      await connect("Spotify");
      h.notices.length = 0;

      ended();
      ended();

      expect(connected()).toEqual([
        { success: true },
        { success: false },
        { success: false },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "info",
          source: "music",
          code: FEEDBACK_CODES.MUSIC_DISCONNECTED,
          message: "Disconnected from Spotify.",
        }),
      ]);
    });

    it("empties the music queue when the provider ends", async () => {
      const { musicService, connect, ended } = await setup();
      await connect("YouTube");

      ended();

      expect(musicService.clearHandler).toHaveBeenCalledOnce();
    });

    it("only replies when a provider that never connected ends", async () => {
      const { h, connect, ended, connected } = await setup(false);
      await connect("Spotify");
      h.notices.length = 0;

      ended();

      expect(connected()).toEqual([
        expect.objectContaining({ success: false, error: expect.any(Object) }),
        { success: false },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replaces the listener of the previous connect", async () => {
      const { events, connect, ended, connected } = await setup();
      await connect("Spotify");
      const [[, first]] = events.on.mock.calls;
      expect(events.off).not.toHaveBeenCalled();

      await connect("YouTube");
      ended();

      expect(events.off).toHaveBeenCalledExactlyOnceWith(
        TOKIO_EVENTS.MUSIC_PROCCESS_ENDED,
        first,
      );
      expect(events.listeners(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED)).toBe(1);
      expect(connected()).toEqual([
        { success: true },
        { success: true },
        { success: false },
      ]);
    });
  });

  describe("IS_MUSIC_CONNECTED", () => {
    it.each([true, false])(
      "answers whether music is connected (%s)",
      async (active) => {
        const { music, createHandler } = await load();
        const h = createHandler({ musicService: { isActive: () => active } });

        await h.invoke(music, APP_EVENTS.IS_MUSIC_CONNECTED);

        expect(h.replies(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
          { success: active },
        ]);
        expect(h.notices).toEqual([]);
      },
    );

    it("replies a failure without a notice", async () => {
      const { music, createHandler } = await load();
      const h = createHandler({
        musicService: {
          isActive: () => {
            throw new Error("no provider");
          },
        },
      });

      await h.invoke(music, APP_EVENTS.IS_MUSIC_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
        expect.objectContaining({ success: false, error: expect.any(Object) }),
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("DISCONNECT_MUSIC", () => {
    it("disconnects and answers that music isn't connected", async () => {
      const { music, createHandler } = await load();
      const disconnect = vi.fn();
      const h = createHandler({ musicService: { disconnect } });

      await h.invoke(music, APP_EVENTS.DISCONNECT_MUSIC);

      expect(disconnect).toHaveBeenCalledOnce();
      expect(h.replies(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
        { success: false },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies and notifies when it can't disconnect", async () => {
      const { music, createHandler } = await load();
      const h = createHandler({
        musicService: {
          disconnect: () => {
            throw new Error("window gone");
          },
        },
      });

      await h.invoke(music, APP_EVENTS.DISCONNECT_MUSIC);

      const failure = {
        code: FEEDBACK_CODES.MUSIC_DISCONNECT_FAILED,
        message: "Unable to disconnect the music provider.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });
});
