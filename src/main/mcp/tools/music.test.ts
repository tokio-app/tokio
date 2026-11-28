import { Profile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import music from "@/events/pages/music";
import { createHandler, eventSource } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

const setup = ({ on = true, connected = true } = {}) => {
  const profile: Profile = structuredClone(defaultProfile);
  profile.music.provider = {
    name: "Spotify",
    key: "client-id",
    block_ads: false,
  };
  const updateProfileData = vi.fn(async (_data: Partial<Profile>) => true);
  const songs = [
    { title: "A", thumbnail: "a.jpg", playing: true, played: false },
    { title: "B", thumbnail: "b.jpg", playing: false, played: false },
  ];
  const events = eventSource();
  const musicService = {
    songs: () => songs,
    isActive: vi.fn(() => connected),
    request: vi.fn(() => true),
    revoke: vi.fn(() => true),
    skip: vi.fn(() => true),
    previous: vi.fn(() => true),
    prepareAdBlocker: vi.fn(),
    setProvider: vi.fn(),
    connect: vi.fn(async () => ({ success: true })),
    disconnect: vi.fn(),
    clearHandler: vi.fn(),
    on: events.on,
    off: events.off,
  };
  const h = createHandler(
    {
      storeManagerService: {
        getProfileData: async () => profile,
        getProfiles: () => [],
        getSettings: () => ({
          activeProfile: { name: "Main", file: "main.json" },
        }),
        getActiveFeatures: () => ({ tts: true, music: on, alerts: true }),
        updateProfileData,
      },
      connectorService: { username: "host" },
      musicService,
    },
    { stack: music },
  );
  return { h, profile, updateProfileData, musicService };
};

describe("music MCP tools", () => {
  describe("music section", () => {
    it("reads the settings without the Client ID", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("get_settings", { section: "music" });

      expect(res.value).toMatchObject({
        values: { provider: { name: "Spotify", block_ads: false } },
        hasKey: true,
      });
      expect(res.text).not.toContain("client-id");
    });

    it("saves without the key, then sends the profile", async () => {
      const { h, updateProfileData, musicService } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "music",
        changes: { provider: { block_ads: true } },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      const saved = updateProfileData.mock.calls[0][0].music;
      expect(saved?.provider).toEqual({ name: "Spotify", block_ads: true });
      expect(musicService.prepareAdBlocker).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
    });

    it("refuses the key", async () => {
      const { h, updateProfileData } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "music",
        changes: { provider: { key: "other" } },
      });

      expect(res.isError).toBe(true);
      expect(updateProfileData).not.toHaveBeenCalled();
    });
  });

  it("lists the queue without thumbnails", async () => {
    const { h } = setup();
    const { call } = await mcpClient(h.handler);

    expect((await call("list", { kind: "music_queue" })).value).toEqual({
      connected: true,
      total: 2,
      songs: [
        { title: "A", playing: true, played: false },
        { title: "B", playing: false, played: false },
      ],
    });
  });

  describe("music tool", () => {
    it("requests as the host and returns the queue", async () => {
      const { h, musicService } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("music", { action: "request", query: "Song" });

      expect(musicService.request).toHaveBeenCalledWith("Song", "host");
      expect(res.value).toMatchObject({ done: true, connected: true });
    });

    it.each([
      [{ on: false }, "The music feature is off"],
      [{ connected: false }, "isn't connected"],
    ])("refuses a request with %o", async (state, text) => {
      const { h, musicService } = setup(state);
      const { call } = await mcpClient(h.handler);

      const res = await call("music", { action: "request", query: "Song" });

      expect(res.isError).toBe(true);
      expect(res.text).toContain(text);
      expect(musicService.request).not.toHaveBeenCalled();
    });

    it("needs a query to revoke", async () => {
      const { h, musicService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("music", { action: "revoke" })).isError).toBe(true);
      await call("music", { action: "revoke", query: "B" });
      expect(musicService.revoke).toHaveBeenCalledWith("B");
    });

    it("goes back, and leaves skipping to control skip_song", async () => {
      const { h, musicService } = setup();
      const { call } = await mcpClient(h.handler);

      await call("music", { action: "previous" });
      const next = await call("music", { action: "next" });

      expect(musicService.previous).toHaveBeenCalledOnce();
      expect(next.isError).toBe(true);
      expect(musicService.skip).not.toHaveBeenCalled();
    });

    it("starts CONNECT_MUSIC with the profile's player and returns at once", async () => {
      const { h, musicService } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("music", { action: "connect" });

      expect(res.value).toMatchObject({ connecting: true });
      expect(invoke).toHaveBeenCalledWith(APP_EVENTS.CONNECT_MUSIC, {
        name: "Spotify",
        key: "client-id",
        block_ads: false,
      });
      expect(musicService.setProvider).toHaveBeenCalledWith(
        "Spotify",
        "client-id",
      );
      // The Music page sees it connected
      await vi.waitFor(() =>
        expect(h.pushed(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
          { success: true },
        ]),
      );
      expect(res.text).not.toContain("client-id");
    });

    it("leaves the write chain free while the player still connects", async () => {
      const { h, musicService } = setup();
      // Spotify waiting for the streamer to log in
      let finish: (res: { success: boolean }) => void = () => {};
      musicService.connect.mockReturnValue(
        new Promise((resolve) => (finish = resolve)),
      );
      const { call } = await mcpClient(h.handler);

      await call("music", { action: "connect" });
      const previous = await call("music", { action: "previous" });

      expect(previous.value).toMatchObject({ done: true });
      expect(musicService.previous).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([]);
      finish({ success: true });
      await vi.waitFor(() =>
        expect(h.pushed(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toHaveLength(1),
      );
    });

    it("reports a failed connect through the handler's notice", async () => {
      const { h, musicService } = setup();
      musicService.connect.mockResolvedValue({ success: false });
      const { call } = await mcpClient(h.handler);

      const res = await call("music", { action: "connect" });

      expect(res.isError).toBe(false);
      await vi.waitFor(() =>
        expect(h.notices.at(-1)).toMatchObject({ level: "error" }),
      );
    });

    it("disconnects through DISCONNECT_MUSIC", async () => {
      const { h, musicService } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("music", { action: "disconnect" });

      expect(res.isError).toBe(false);
      expect(musicService.disconnect).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.MUSIC_CONNECTED)).toEqual([
        { success: false },
      ]);
    });
  });
});
