import { Alert, ALERT_TRIGGERS, Profile, SavedEmote } from "@/common/schemas";
import {
  AlertTrigger,
  ALERT_TRIGGER_LABELS,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  ChatEvent,
  CustomGift,
  EMOTE_TRIGGER,
  Emotes,
  FEEDBACK_CODES,
  Files,
  Folders,
  Gift,
  GiftEvent,
  LikeEvent,
  RoomUserEvent,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import {
  defaultProfile,
  defaultStoreData,
  generateTikTokEventSample,
} from "@/common/util";
import config from "@/config";
import Logger from "@/logger";
import type { AlertsService } from "@/services/alerts";
import type { ReconnectState } from "@/services/connector/common";
import { LiveService } from "@/services/live";
import type { MusicService } from "@/services/music";
import type { OverlayService } from "@/services/overlay";
import type { StoreManagerService } from "@/services/store";
import type { TTSService } from "@/services/tts";
import type { UpdaterService } from "@/services/updater";
import { app } from "@test/electron";
import { createHandler, eventSource } from "@test/handler";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import init from "./init";

const files: Files = {
  logs: {
    connector: "connector.log",
    tts: "tts.log",
    system: "system.log",
    server: "server.log",
    alerts: "alerts.log",
    music: "music.log",
    overlays: "overlays.log",
  },
  gifts: "extra/gifts.json",
  customGifts: "extra/custom-gifts.json",
};

const folders: Folders = {
  appFolder: "app",
  settingsFolder: "app/settings",
  logsFolder: "app/logs",
  overlaysFolder: "app/overlays",
  profilesFolder: "app/profiles",
  extraFolder: "app/extra",
  soundsFolder: "app/sounds",
};

const noStats = { likes: 0, viewers: 0, views: 0 };
const profile: Profile = { ...defaultProfile, name: "Stream" };
const profiles = [{ name: "Stream", file: "stream.json" }];
const tiktokRose: Gift = {
  id: 5655,
  name: "Rose",
  coins: 1,
  image: "rose.png",
};
const rose: CustomGift = {
  value: 5655,
  label: "Rose",
  img: "rose.png",
  coins: 1,
};
const lion: CustomGift = {
  value: 6369,
  label: "Lion",
  img: "lion.png",
  coins: 29999,
};

const user: UserData = {
  username: "Viewer",
  handle: "viewer",
  profilePictures: [],
};

const emote = (id: string): Emotes => ({
  emoteID: id,
  index: 0,
  images: [`${id}.png`],
});

const chat = (content: string, emotes: Emotes[] = []): ChatEvent => ({
  user,
  comment: { content, emotes, lang: "en" },
});

const giftEvent = (id: string, name: string): GiftEvent => ({
  user,
  gift: {
    id,
    name,
    coins: 1,
    repeatEnd: true,
    type: 1,
    comboCount: 1,
    image: `${id}.png`,
  },
});

const roomUser = (views: number, viewers: number): RoomUserEvent => ({
  ranks: [],
  views,
  viewers,
});

const like = (totalLikes: number): LikeEvent => ({
  user,
  likeCount: 1,
  totalLikes,
});

const alert = (overrides: Partial<Alert> = {}): Alert => ({
  id: "alert-1",
  enabled: true,
  trigger: {
    type: TOKIO_EVENTS.FOLLOW,
    gifts: [],
    emotes: [],
    keyword: "",
    user: "",
  },
  sound: { name: "Ding", file: "ding.mp3" },
  tts: null,
  volume: 80,
  ...overrides,
});

const speech: NonNullable<Alert["tts"]> = {
  voice: { engine: "edge", name: "Aria", lang: "en-US" },
  message: "Thanks for the follow!",
  speed: 1,
  pitch: 1,
};

// Every service LOAD_APP reaches, with the live events of the connector and
// the music service. Tests change the mocks before loading the app.
function setup() {
  const conn = eventSource();
  const music = eventSource();
  const features = { tts: false, music: false, alerts: true };
  const settings = {
    server: { enabled: true },
    updates: { auto: false },
    activityFeed: { ...defaultStoreData.settings.activityFeed },
  };

  const pathManagerService = {
    files,
    folders,
    initialize: vi.fn(
      async (
        _home: string,
        _folder: string,
        callback?: (data: { files: Files; folders: Folders }) => void,
      ) => callback?.({ files, folders }),
    ),
  };
  const connectorService = {
    ...conn,
    setLogFile: vi.fn(),
    onReconnect: vi.fn((_listener: (state: ReconnectState) => void) => {}),
    fetchGifts: vi.fn(
      async (): Promise<{ success: boolean; data: Gift[] }> => ({
        success: true,
        data: [tiktokRose],
      }),
    ),
  };
  const ttsService = {
    setLogFile: vi.fn(),
    talk: vi.fn((..._args: Parameters<TTSService["talk"]>) => {}),
    clearTalk: vi.fn(),
    releaseHeld: vi.fn(),
  };
  const musicService = {
    ...music,
    setLogFile: vi.fn(),
    isActive: vi.fn(() => false),
    handle: vi.fn(),
    clearHandler: vi.fn(),
    onPlaybackError: vi.fn(
      (..._args: Parameters<MusicService["onPlaybackError"]>) => {},
    ),
  };
  const serverService = {
    setLogFile: vi.fn(),
    initEvents: vi.fn(),
    toggleServer: vi.fn(async (_enabled: boolean) => true),
  };
  const overlayService = {
    setLogFile: vi.fn(),
    initialize: vi.fn(),
    getGifts: vi.fn(async (): Promise<CustomGift[]> => []),
    load: vi.fn(async (_gifts: CustomGift[]) => {}),
    refreshGifts: vi.fn(async (_gifts: CustomGift[]) => {}),
    recordGift: vi.fn(
      async (
        ..._args: Parameters<OverlayService["recordGift"]>
      ): Promise<{ success: boolean; data?: CustomGift[] }> => ({
        success: true,
      }),
    ),
  };
  const storeManagerService = {
    setLogFile: vi.fn(),
    initialize: vi.fn(
      async (..._args: Parameters<StoreManagerService["initialize"]>) => {},
    ),
    getSettings: () => settings,
    getActiveFeatures: () => features,
    getProfileData: vi.fn(async (): Promise<Profile | null> => profile),
    getProfiles: vi.fn(() => profiles),
    updateLiveStats: vi.fn(),
    updateServerSettings: vi.fn(async (_enabled: boolean) => {}),
    recordEmotes: vi.fn(
      async (
        ..._args: Parameters<StoreManagerService["recordEmotes"]>
      ): Promise<{ success: boolean; data?: SavedEmote[] }> => ({
        success: true,
      }),
    ),
  };
  const alertsService = {
    setLogFile: vi.fn(),
    setSoundsFolder: vi.fn(),
    setSpeaker: vi.fn(),
    handle: vi.fn(async (..._args: Parameters<AlertsService["handle"]>) => {}),
    clearSpeech: vi.fn(),
  };
  const updaterService = {
    setLogFile: vi.fn(),
    initialize: vi.fn(
      async (..._args: Parameters<UpdaterService["initialize"]>) => {},
    ),
    start: vi.fn(),
  };
  const urlManagerService = { setLogFile: vi.fn() };
  const jsonManagerService = { setLogFile: vi.fn() };
  const licensesService = { setLogFile: vi.fn() };
  const liveService = new LiveService();

  const h = createHandler({
    pathManagerService,
    connectorService,
    ttsService,
    musicService,
    serverService,
    overlayService,
    storeManagerService,
    alertsService,
    updaterService,
    urlManagerService,
    jsonManagerService,
    licensesService,
    liveService,
    yamlManagerService: {},
  });

  return {
    h,
    conn,
    music,
    features,
    settings,
    pathManagerService,
    connectorService,
    ttsService,
    musicService,
    serverService,
    overlayService,
    storeManagerService,
    alertsService,
    updaterService,
    urlManagerService,
    jsonManagerService,
    licensesService,
    liveService,
  };
}

type Setup = ReturnType<typeof setup>;

const load = (s: Setup) => s.h.invoke(init, APP_EVENTS.LOAD_APP);

// A loaded app, without the notices of loading it
async function live(features: Partial<Setup["features"]> = {}) {
  const s = setup();
  Object.assign(s.features, features);
  await load(s);
  s.h.notices.length = 0;
  return s;
}

const noticesFor = (s: Setup, code: FEEDBACK_CODES) =>
  s.h.notices.filter((n) => n.code === code);

// Lets fire-and-forget work finish, before asserting it did nothing
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

// Emits a live event whose type is only known at runtime
const emitLive = (
  source: { emit(event: TOKIO_EVENTS, data: any): void },
  event: TOKIO_EVENTS,
  data: unknown,
) => source.emit(event, data);

// The store answers undefined before it's initialized
const missing = (): any => undefined;

describe("init events", () => {
  let logError: MockInstance<typeof Logger.error>;
  let logWarn: MockInstance<typeof Logger.warn>;

  // To check what the handlers log
  beforeEach(() => {
    logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
    logWarn = vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("alerts", () => {
    const triggers = ALERT_TRIGGERS.filter(
      (t): t is Exclude<AlertTrigger, typeof EMOTE_TRIGGER> =>
        t !== EMOTE_TRIGGER,
    );

    it.each(triggers)("passes %s to the alerts", async (trigger) => {
      const s = await live();
      const { data } = generateTikTokEventSample(trigger);

      const source = trigger === TOKIO_EVENTS.MUSIC_CHANGE ? s.music : s.conn;
      emitLive(source, trigger, data);

      await vi.waitFor(() => {
        expect(s.alertsService.handle).toHaveBeenCalledExactlyOnceWith(
          trigger,
          data,
          profile,
          expect.any(Function),
          expect.any(Function),
        );
      });
    });

    it("takes Music Change from the music service and the rest from the connector", async () => {
      const s = await live();
      const subscribed = (source: Setup["conn"]) =>
        source.on.mock.calls.map(([event]) => event);

      expect(subscribed(s.music)).toEqual([TOKIO_EVENTS.MUSIC_CHANGE]);
      expect(subscribed(s.conn)).not.toContain(TOKIO_EVENTS.MUSIC_CHANGE);
      for (const trigger of triggers) {
        if (trigger === TOKIO_EVENTS.MUSIC_CHANGE) continue;
        expect(subscribed(s.conn)).toContain(trigger);
      }
    });

    it("doesn't subscribe to the Emote trigger, which isn't a live event", async () => {
      const s = await live();
      const events = [...s.conn.on.mock.calls, ...s.music.on.mock.calls].map(
        ([event]) => event,
      );

      expect(events).not.toContain(EMOTE_TRIGGER);
    });

    it("drops live events while the alerts are off", async () => {
      const s = await live({ alerts: false });
      const first = generateTikTokEventSample(TOKIO_EVENTS.FOLLOW).data;
      const second = generateTikTokEventSample(TOKIO_EVENTS.SHARE).data;

      s.conn.emit(TOKIO_EVENTS.FOLLOW, first);
      s.features.alerts = true;
      s.conn.emit(TOKIO_EVENTS.SHARE, second);

      await vi.waitFor(() => {
        expect(s.alertsService.handle).toHaveBeenCalled();
      });
      expect(s.alertsService.handle).toHaveBeenCalledOnce();
      expect(s.alertsService.handle.mock.calls[0][0]).toBe(TOKIO_EVENTS.SHARE);
    });

    it("pushes the sounds the alerts play", async () => {
      const s = await live();
      const audio = {
        data: new Uint8Array([1, 2]),
        volume: 80,
        channel: "alerts",
        maxQueueLength: 100,
        id: "alert-1",
      };
      s.alertsService.handle.mockImplementation(async (_t, _p, _prof, play) => {
        play(audio);
      });

      s.conn.emit(TOKIO_EVENTS.FOLLOW, { user });

      await vi.waitFor(() => {
        expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([audio]);
      });
    });

    it("reports an alert that fails to play with its trigger's label", async () => {
      const s = await live();
      s.alertsService.handle.mockRejectedValue(new Error("decode failed"));

      s.conn.emit(
        TOKIO_EVENTS.GIFT,
        generateTikTokEventSample(TOKIO_EVENTS.GIFT).data,
      );

      await vi.waitFor(() => {
        expect(s.h.notices).toEqual([
          expect.objectContaining({
            level: "error",
            source: "alerts",
            code: FEEDBACK_CODES.ALERT_FAILED,
            message: `Unable to play the ${ALERT_TRIGGER_LABELS[TOKIO_EVENTS.GIFT]} alert.`,
          }),
        ]);
      });
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(TOKIO_EVENTS.GIFT),
        "alerts.log",
        expect.any(Error),
      );
    });

    // The failure callback the alerts got for a follow
    async function onFailure() {
      const s = await live();
      s.conn.emit(TOKIO_EVENTS.FOLLOW, { user });
      await vi.waitFor(() => {
        expect(s.alertsService.handle).toHaveBeenCalled();
      });
      const callback = s.alertsService.handle.mock.calls[0][4];
      if (!callback) throw new Error("The alerts got no failure callback.");
      return { s, callback };
    }

    it("warns that a TTS alert couldn't be spoken", async () => {
      const { s, callback } = await onFailure();

      callback(alert({ tts: speech }));

      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "alerts",
          code: FEEDBACK_CODES.ALERT_TTS_FAILED,
          message:
            "Unable to speak the Follow alert. Try another voice in Alerts.",
        }),
      ]);
    });

    it("warns that a sound alert's sound is missing", async () => {
      const { s, callback } = await onFailure();

      callback(
        alert({
          trigger: { ...alert().trigger, type: TOKIO_EVENTS.SHARE },
        }),
      );

      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "alerts",
          code: FEEDBACK_CODES.ALERT_SOUND_MISSING,
          message:
            "The sound of the Share alert is missing. Pick it again in Alerts.",
        }),
      ]);
    });

    it("warns about each alert at most once every 30 seconds", async () => {
      const { s, callback } = await onFailure();
      vi.useFakeTimers();

      callback(alert());
      vi.advanceTimersByTime(29_999);
      callback(alert());
      callback(alert({ tts: speech }));
      callback(alert({ id: "alert-2" }));
      expect(s.h.notices.map((n) => n.code)).toEqual([
        FEEDBACK_CODES.ALERT_SOUND_MISSING,
        FEEDBACK_CODES.ALERT_SOUND_MISSING,
      ]);

      vi.advanceTimersByTime(1);
      callback(alert({ tts: speech }));
      expect(s.h.notices.map((n) => n.code)).toEqual([
        FEEDBACK_CODES.ALERT_SOUND_MISSING,
        FEEDBACK_CODES.ALERT_SOUND_MISSING,
        FEEDBACK_CODES.ALERT_TTS_FAILED,
      ]);
    });
  });

  describe("stats", () => {
    it("saves the viewers, views and likes", async () => {
      const s = await live();

      s.conn.emit(TOKIO_EVENTS.ROOM_USER, roomUser(120, 8));
      s.conn.emit(TOKIO_EVENTS.LIKE, like(42));

      expect(s.storeManagerService.updateLiveStats).toHaveBeenCalledWith({
        viewers: 8,
        views: 120,
      });
      expect(s.storeManagerService.updateLiveStats).toHaveBeenLastCalledWith({
        likes: 42,
      });
    });

    it("pushes views and likes at most every 250ms, with the latest values", async () => {
      vi.useFakeTimers();
      const s = await live();

      for (const n of [1, 2, 3]) {
        s.conn.emit(TOKIO_EVENTS.ROOM_USER, roomUser(n * 10, n));
        s.conn.emit(TOKIO_EVENTS.LIKE, like(n * 100));
      }
      expect(s.h.pushed(APP_EVENTS_RESPONSE.VIEWS)).toEqual([
        { data: { views: 10, viewers: 1 } },
      ]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.LIKES)).toEqual([{ likes: 100 }]);

      vi.advanceTimersByTime(249);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.VIEWS)).toHaveLength(1);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.LIKES)).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.VIEWS)).toEqual([
        { data: { views: 10, viewers: 1 } },
        { data: { views: 30, viewers: 3 } },
      ]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.LIKES)).toEqual([
        { likes: 100 },
        { likes: 300 },
      ]);
    });
  });

  describe("live session", () => {
    const noTotals = { followers: 0, shares: 0, gifts: 0, coins: 0 };
    // What the Home page got, oldest first
    const sessions = (s: Setup) =>
      s.h.pushed(APP_EVENTS_RESPONSE.LIVE_SESSION).map(({ data }) => data);
    const connect = (s: Setup) =>
      s.conn.emit(TOKIO_EVENTS.CONNECTED, { success: true });

    it("starts the session when the LIVE connects", async () => {
      vi.useFakeTimers({ now: 5000 });
      const s = await live();

      connect(s);

      expect(sessions(s)).toEqual([
        { startedAt: 5000, totals: noTotals, activity: [] },
      ]);
    });

    it("doesn't start it when connecting fails", async () => {
      const s = await live();

      s.conn.emit(TOKIO_EVENTS.CONNECTED, { success: false });

      expect(sessions(s)).toEqual([]);
    });

    it("pushes the LIVE's events at most every 250ms, with the latest session", async () => {
      vi.useFakeTimers();
      const s = await live();
      connect(s);

      s.conn.emit(TOKIO_EVENTS.FOLLOW, { user });
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hello"));
      s.conn.emit(TOKIO_EVENTS.GIFT, giftEvent("5655", "Rose"));
      expect(sessions(s)).toHaveLength(2);

      vi.advanceTimersByTime(250);
      expect(sessions(s)).toHaveLength(3);
      expect(sessions(s)[2]).toMatchObject({
        totals: { followers: 1, shares: 0, gifts: 1, coins: 1 },
        activity: [
          expect.objectContaining({ type: "gift" }),
          expect.objectContaining({ type: "chat", text: "hello" }),
          expect.objectContaining({ type: "follow" }),
        ],
      });
    });

    it("pushes nothing for events that don't change it", async () => {
      vi.useFakeTimers();
      const s = await live();
      connect(s);
      const combo = giftEvent("5655", "Rose");
      combo.gift.repeatEnd = false;

      s.conn.emit(TOKIO_EVENTS.LIKE, like(5));
      s.conn.emit(TOKIO_EVENTS.ROOM_USER, roomUser(10, 1));
      s.conn.emit(TOKIO_EVENTS.GIFT, combo);
      vi.advanceTimersByTime(1000);

      expect(sessions(s)).toHaveLength(1);
    });

    it("keeps the kinds of events the saved feed shows", async () => {
      const s = setup();
      s.settings.activityFeed.chat = false;
      await load(s);
      connect(s);

      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hidden"));
      s.conn.emit(TOKIO_EVENTS.FOLLOW, { user });

      expect(sessions(s).at(-1)).toMatchObject({
        activity: [expect.objectContaining({ type: "follow" })],
      });
    });

    it("ends the session when the LIVE disconnects, keeping its feed", async () => {
      vi.useFakeTimers();
      const s = await live();
      connect(s);
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("bye"));
      // Waits for the throttle
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("see you"));

      s.conn.emit(TOKIO_EVENTS.DISCONNECTED, undefined);
      vi.advanceTimersByTime(1000);

      expect(sessions(s)).toHaveLength(3);
      expect(sessions(s)[2]).toMatchObject({
        startedAt: null,
        activity: [
          expect.objectContaining({ text: "see you" }),
          expect.objectContaining({ text: "bye" }),
        ],
      });
    });
  });

  describe("disconnect", () => {
    it("drops the stats still waiting to be pushed", async () => {
      vi.useFakeTimers();
      const s = await live();
      s.conn.emit(TOKIO_EVENTS.ROOM_USER, roomUser(10, 1));
      s.conn.emit(TOKIO_EVENTS.ROOM_USER, roomUser(20, 2));
      s.conn.emit(TOKIO_EVENTS.LIKE, like(1));
      s.conn.emit(TOKIO_EVENTS.LIKE, like(2));

      s.conn.emit(TOKIO_EVENTS.DISCONNECTED, undefined);
      vi.advanceTimersByTime(1000);

      expect(s.h.pushed(APP_EVENTS_RESPONSE.VIEWS)).toHaveLength(1);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.LIKES)).toHaveLength(1);
    });

    it("stops music requests, TTS and alerts, and resets the stats", async () => {
      const s = await live();
      s.conn.emit(TOKIO_EVENTS.ROOM_USER, roomUser(10, 1));

      s.conn.emit(TOKIO_EVENTS.DISCONNECTED, undefined);

      expect(s.musicService.clearHandler).toHaveBeenCalledOnce();
      expect(s.ttsService.clearTalk).toHaveBeenCalledOnce();
      expect(s.alertsService.clearSpeech).toHaveBeenCalledOnce();
      expect(s.h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toEqual([undefined]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([undefined]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: false, stats: noStats },
      ]);
      expect(s.storeManagerService.updateLiveStats).toHaveBeenLastCalledWith(
        noStats,
      );
    });

    it("says when the LIVE has ended", async () => {
      const s = await live();

      s.conn.emit(TOKIO_EVENTS.DISCONNECTED, { reason: "ended" });

      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "info",
          source: "connector",
          code: FEEDBACK_CODES.LIVE_ENDED,
          message: "The LIVE has ended.",
        }),
      ]);
    });

    it("says when the connection was lost", async () => {
      const s = await live();

      s.conn.emit(TOKIO_EVENTS.DISCONNECTED, { reason: "lost" });

      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "connector",
          code: FEEDBACK_CODES.CONNECTION_LOST,
          message: "Unable to reconnect to the LIVE. Connect again from Home.",
        }),
      ]);
    });

    it("says while it reconnects, and once it's back, keeping the LIVE", async () => {
      const s = await live();
      const [reconnect] = s.connectorService.onReconnect.mock.calls[0];

      reconnect("reconnecting");
      reconnect("reconnected");

      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "connector",
          code: FEEDBACK_CODES.RECONNECTING,
          message: "The connection to the LIVE dropped. Reconnecting…",
        }),
        expect.objectContaining({
          level: "info",
          source: "connector",
          code: FEEDBACK_CODES.RECONNECTED,
          message: "Reconnected to the LIVE.",
        }),
      ]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([]);
    });

    it.each([undefined, {}])(
      "says it disconnected for any other reason (%o)",
      async (data) => {
        const s = await live();

        s.conn.emit(TOKIO_EVENTS.DISCONNECTED, data);

        expect(s.h.notices).toEqual([
          expect.objectContaining({
            level: "info",
            source: "connector",
            code: FEEDBACK_CODES.DISCONNECTED,
            message: "Disconnected from the LIVE.",
          }),
        ]);
      },
    );
  });

  describe("chat", () => {
    // What TTS got for the first chat
    async function talked(s: Setup) {
      await vi.waitFor(() => {
        expect(s.ttsService.talk).toHaveBeenCalled();
      });
      const [, , onAudio, onFailure] = s.ttsService.talk.mock.calls[0];
      if (!onAudio || !onFailure) throw new Error("TTS got no callbacks.");
      return { onAudio, onFailure };
    }

    it("reads chats aloud with the profile's TTS settings while TTS is on", async () => {
      const s = await live({ tts: true });
      const message = chat("hello there");

      s.conn.emit(TOKIO_EVENTS.CHAT, message);

      await talked(s);
      expect(s.ttsService.talk).toHaveBeenCalledExactlyOnceWith(
        message,
        profile.tts,
        expect.any(Function),
        expect.any(Function),
      );
      expect(s.ttsService.clearTalk).not.toHaveBeenCalled();
    });

    it("pushes the audio TTS made", async () => {
      const s = await live({ tts: true });
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hello"));
      const { onAudio } = await talked(s);
      const audio = {
        id: 1,
        data: Buffer.from([7]),
        filters: profile.tts.filters,
        queueOptions: { gapTime: 2, maxQueueLength: 10 },
      };

      onAudio(audio);

      expect(s.h.pushed(APP_EVENTS_RESPONSE.TTS_AUDIO)).toEqual([audio]);
    });

    it("reports TTS failures at most once every 30 seconds", async () => {
      const s = await live({ tts: true });
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hello"));
      const { onFailure } = await talked(s);
      vi.useFakeTimers();
      const failure = expect.objectContaining({
        level: "error",
        source: "tts",
        code: FEEDBACK_CODES.TTS_GENERATION_FAILED,
        message:
          "Unable to generate TTS audio. Try another voice on the TTS page.",
      });

      onFailure();
      vi.advanceTimersByTime(29_999);
      onFailure();
      expect(s.h.notices).toEqual([failure]);

      vi.advanceTimersByTime(1);
      onFailure();
      expect(s.h.notices).toEqual([failure, failure]);
    });

    it("stops reading chats while TTS is off", async () => {
      const s = await live({ tts: false });

      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hello"));

      await vi.waitFor(() => {
        expect(s.ttsService.clearTalk).toHaveBeenCalledOnce();
      });
      expect(s.ttsService.talk).not.toHaveBeenCalled();
    });

    it("passes chats to music requests while music is on and connected", async () => {
      const s = await live({ music: true });
      s.musicService.isActive.mockReturnValue(true);
      const message = chat("!play song");

      s.conn.emit(TOKIO_EVENTS.CHAT, message);

      await vi.waitFor(() => {
        expect(s.musicService.handle).toHaveBeenCalledExactlyOnceWith(
          message,
          profile.music,
        );
      });
      expect(s.musicService.clearHandler).not.toHaveBeenCalled();
    });

    it.each([
      { music: true, active: false },
      { music: false, active: true },
    ])(
      "stops music requests when music is on: $music, connected: $active",
      async ({ music, active }) => {
        const s = await live({ music });
        s.musicService.isActive.mockReturnValue(active);

        s.conn.emit(TOKIO_EVENTS.CHAT, chat("!play song"));

        await vi.waitFor(() => {
          expect(s.musicService.clearHandler).toHaveBeenCalledOnce();
        });
        expect(s.musicService.handle).not.toHaveBeenCalled();
      },
    );

    it("records the emotes of a chat and pushes the new list", async () => {
      const s = await live({ alerts: false });
      const saved = [{ id: "wave", image: "wave.png" }];
      s.storeManagerService.recordEmotes.mockResolvedValue({
        success: true,
        data: saved,
      });
      const emotes = [emote("wave")];

      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hi", emotes));

      expect(
        s.storeManagerService.recordEmotes,
      ).toHaveBeenCalledExactlyOnceWith(emotes);
      await vi.waitFor(() => {
        expect(s.h.pushed(APP_EVENTS_RESPONSE.EMOTES)).toEqual([
          { data: saved },
        ]);
      });
    });

    it("pushes nothing when the chat brought no new emotes", async () => {
      const s = await live({ alerts: false });

      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hi", [emote("wave")]));
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hi again", [emote("wave")]));

      expect(s.storeManagerService.recordEmotes).toHaveBeenCalledTimes(2);
      await flushPromises();
      expect(s.h.pushed(APP_EVENTS_RESPONSE.EMOTES)).toEqual([]);
      expect(s.h.notices).toEqual([]);
    });

    it("warns when the emotes can't be saved, at most once every 30 seconds", async () => {
      const s = await live({ alerts: false });
      const warn = vi.spyOn(s.h.handler.notifier, "warn");
      s.storeManagerService.recordEmotes.mockResolvedValue({ success: false });

      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hi", [emote("wave")]));
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hi", [emote("heart")]));

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledTimes(2);
      });
      expect(warn).toHaveBeenCalledWith(
        "alerts",
        FEEDBACK_CODES.EMOTES_SAVE_FAILED,
        "Unable to save the LIVE's new emotes.",
        { key: "emotes", windowMs: 30_000 },
      );
      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.EMOTES_SAVE_FAILED,
        }),
      ]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.EMOTES)).toEqual([]);
    });

    it("records nothing for a chat without emotes", async () => {
      const s = await live({ alerts: false });

      s.conn.emit(TOKIO_EVENTS.CHAT, chat("no emotes here"));

      expect(s.storeManagerService.recordEmotes).not.toHaveBeenCalled();
    });

    it("records the gifts viewers send and pushes the new custom gifts", async () => {
      const s = await live({ alerts: false });
      const custom = [{ value: 9, label: "Galaxy", img: "9.png", coins: 1 }];
      s.overlayService.recordGift.mockResolvedValue({
        success: true,
        data: custom,
      });
      const sent = giftEvent("9", "Galaxy");

      s.conn.emit(TOKIO_EVENTS.GIFT, sent);

      expect(s.overlayService.recordGift).toHaveBeenCalledExactlyOnceWith(
        sent.gift,
      );
      await vi.waitFor(() => {
        expect(s.h.pushed(APP_EVENTS_RESPONSE.CUSTOM_GIFTS)).toEqual([
          { data: custom },
        ]);
      });
    });

    it("pushes nothing when a gift changed no custom gift", async () => {
      const s = await live({ alerts: false });

      s.conn.emit(TOKIO_EVENTS.GIFT, giftEvent("5655", "Rose"));

      expect(s.overlayService.recordGift).toHaveBeenCalledOnce();
      await flushPromises();
      expect(s.h.pushed(APP_EVENTS_RESPONSE.CUSTOM_GIFTS)).toEqual([]);
      expect(s.h.notices).toEqual([]);
    });

    it("warns when the gifts can't be saved, at most once every 30 seconds", async () => {
      const s = await live({ alerts: false });
      const warn = vi.spyOn(s.h.handler.notifier, "warn");
      s.overlayService.recordGift.mockResolvedValue({ success: false });

      s.conn.emit(TOKIO_EVENTS.GIFT, giftEvent("9", "Galaxy"));
      s.conn.emit(TOKIO_EVENTS.GIFT, giftEvent("8", "Comet"));

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledTimes(2);
      });
      expect(warn).toHaveBeenCalledWith(
        "alerts",
        FEEDBACK_CODES.GIFTS_SAVE_FAILED,
        "Unable to save the LIVE's new gifts.",
        { key: "gifts", windowMs: 30_000 },
      );
      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.GIFTS_SAVE_FAILED,
        }),
      ]);
      expect(s.h.pushed(APP_EVENTS_RESPONSE.CUSTOM_GIFTS)).toEqual([]);
    });
  });

  describe("music playback", () => {
    it("warns when a song request couldn't be played", async () => {
      const s = await live();
      const [listener] = s.musicService.onPlaybackError.mock.calls[0];

      listener("track-1", new Error("unavailable"));

      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "music",
          code: FEEDBACK_CODES.MUSIC_PLAYBACK_FAILED,
          message: "A song request couldn't be played and was skipped.",
        }),
      ]);
    });
  });

  describe("GET_PROFILE", () => {
    it("answers with the active profile and the list of profiles", async () => {
      const s = setup();

      await s.h.invoke(init, APP_EVENTS.GET_PROFILE);

      expect(s.h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([
        { success: true, profile, profiles },
      ]);
      expect(s.h.notices).toEqual([]);
    });

    const failure = {
      code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
      message: "Unable to load the profile.",
    };

    it("fails when the profile is missing", async () => {
      const s = setup();
      s.storeManagerService.getProfileData.mockResolvedValue(null);

      await s.h.invoke(init, APP_EVENTS.GET_PROFILE);

      expect(s.h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([
        { success: false, error: failure },
      ]);
      expect(s.h.notices).toEqual([expect.objectContaining(failure)]);
    });

    it("fails when the list of profiles is missing", async () => {
      const s = setup();
      s.storeManagerService.getProfiles.mockReturnValue(missing());

      await s.h.invoke(init, APP_EVENTS.GET_PROFILE);

      expect(s.h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([
        { success: false, error: failure },
      ]);
      expect(s.h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("LOAD_APP", () => {
    it("sets up the folders in the home folder and hands out the log files", async () => {
      const s = setup();
      app.getPath.mockImplementation((name) => `/users/${name}`);

      await load(s);

      expect(app.getPath).toHaveBeenCalledWith("home");
      expect(s.pathManagerService.initialize).toHaveBeenCalledWith(
        "/users/home",
        config.APP.folderName,
        expect.any(Function),
      );
      expect(s.connectorService.setLogFile).toHaveBeenCalledWith(
        "connector.log",
      );
      expect(s.ttsService.setLogFile).toHaveBeenCalledWith("tts.log");
      expect(s.serverService.setLogFile).toHaveBeenCalledWith("server.log");
      expect(s.overlayService.setLogFile).toHaveBeenCalledWith("overlays.log");
      expect(s.alertsService.setLogFile).toHaveBeenCalledWith("alerts.log");
      expect(s.musicService.setLogFile).toHaveBeenCalledWith("music.log");
      for (const service of [
        s.urlManagerService,
        s.storeManagerService,
        s.jsonManagerService,
        s.licensesService,
        s.updaterService,
      ]) {
        expect(service.setLogFile).toHaveBeenCalledWith("system.log");
      }
      expect(s.alertsService.setSoundsFolder).toHaveBeenCalledWith(
        "app/sounds",
      );
      expect(s.alertsService.setSpeaker.mock.calls[0][0]).toBe(
        s.h.handler.ttsService,
      );
    });

    it("initializes the store, the overlays and the server's events", async () => {
      const s = setup();
      const { handler } = s.h;

      await load(s);

      const [name, providers, json, paths] =
        s.storeManagerService.initialize.mock.calls[0];
      expect(name).toBe(config.DB.name);
      expect(providers.connector).toBe(handler.connectorService);
      expect(providers.tts).toBe(handler.ttsService);
      expect(json).toBe(handler.jsonManagerService);
      expect(paths).toBe(handler.pathManagerService);

      const [locations, services] = s.overlayService.initialize.mock.calls[0];
      expect(locations).toEqual({
        folder: "app/overlays",
        giftsFile: "extra/gifts.json",
        customGiftsFile: "extra/custom-gifts.json",
      });
      expect(services.yaml).toBe(handler.yamlManagerService);
      expect(services.json).toBe(handler.jsonManagerService);
      expect(services.server).toBe(handler.serverService);
      expect(services.store).toBe(handler.storeManagerService);

      const [connector, music] = s.serverService.initEvents.mock.calls[0];
      expect(connector).toBe(handler.connectorService);
      expect(music).toBe(handler.musicService);
      expect(s.storeManagerService.updateLiveStats).toHaveBeenCalledWith(
        noStats,
      );
    });

    describe("with gifts saved last time", () => {
      it("loads the overlays with them before asking TikTok", async () => {
        const s = setup();
        s.overlayService.getGifts.mockResolvedValue([lion]);

        await load(s);

        expect(s.overlayService.load).toHaveBeenCalledExactlyOnceWith([lion]);
        expect(s.overlayService.load.mock.invocationCallOrder[0]).toBeLessThan(
          s.connectorService.fetchGifts.mock.invocationCallOrder[0],
        );
        await vi.waitFor(() => {
          expect(s.overlayService.refreshGifts).toHaveBeenCalledExactlyOnceWith(
            [rose],
          );
        });
      });

      it("doesn't wait for TikTok to answer", async () => {
        const s = setup();
        s.overlayService.getGifts.mockResolvedValue([lion]);
        s.connectorService.fetchGifts.mockReturnValue(new Promise(() => {}));

        await load(s);

        expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
          { success: true },
        ]);
      });

      it("keeps them when TikTok sends no gifts", async () => {
        const s = setup();
        s.overlayService.getGifts.mockResolvedValue([lion]);
        s.connectorService.fetchGifts.mockResolvedValue({
          success: false,
          data: [],
        });

        await load(s);
        await flushPromises();

        expect(s.overlayService.refreshGifts).not.toHaveBeenCalled();
        expect(noticesFor(s, FEEDBACK_CODES.GIFTS_FETCH_FAILED)).toEqual([]);
      });

      it("warns when the fresh gifts can't be used", async () => {
        const s = setup();
        s.overlayService.getGifts.mockResolvedValue([lion]);
        s.overlayService.refreshGifts.mockRejectedValue(new Error("EACCES"));

        await load(s);

        await vi.waitFor(() => {
          expect(noticesFor(s, FEEDBACK_CODES.GIFTS_FETCH_FAILED)).toEqual([
            expect.objectContaining({
              level: "warning",
              source: "overlays",
              message:
                "Unable to update the gifts from TikTok. Overlays use the ones saved last time.",
            }),
          ]);
        });
        expect(logWarn).toHaveBeenCalledWith(
          expect.stringContaining("EACCES"),
          "overlays.log",
        );
      });
    });

    describe("without saved gifts", () => {
      it("loads the overlays with the gifts from TikTok", async () => {
        const s = setup();

        await load(s);

        expect(s.overlayService.load).toHaveBeenCalledExactlyOnceWith([rose]);
        expect(s.overlayService.refreshGifts).not.toHaveBeenCalled();
        expect(noticesFor(s, FEEDBACK_CODES.GIFTS_FETCH_FAILED)).toEqual([]);
      });

      it("warns that the gift options stay empty when TikTok sends none", async () => {
        const s = setup();
        s.connectorService.fetchGifts.mockResolvedValue({
          success: false,
          data: [],
        });

        await load(s);

        expect(s.overlayService.load).toHaveBeenCalledExactlyOnceWith([]);
        expect(noticesFor(s, FEEDBACK_CODES.GIFTS_FETCH_FAILED)).toEqual([
          expect.objectContaining({
            level: "warning",
            source: "overlays",
            message:
              "Unable to get the gifts from TikTok. Overlay gift options stay empty until the next start.",
          }),
        ]);
        expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
          { success: true },
        ]);
      });
    });

    it("starts the server as saved", async () => {
      const s = setup();

      await load(s);

      expect(s.serverService.toggleServer).toHaveBeenCalledExactlyOnceWith(
        true,
      );
      expect(s.storeManagerService.updateServerSettings).not.toHaveBeenCalled();
      expect(noticesFor(s, FEEDBACK_CODES.SERVER_START_FAILED)).toEqual([]);
    });

    it("turns the server off when it can't start", async () => {
      const s = setup();
      s.serverService.toggleServer.mockResolvedValue(false);

      await load(s);

      const message =
        "The overlay server couldn't start, port 37891 may be in use. It has been turned off.";
      expect(noticesFor(s, FEEDBACK_CODES.SERVER_START_FAILED)).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "server",
          message,
        }),
      ]);
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining(message),
        "server.log",
      );
      expect(
        s.storeManagerService.updateServerSettings,
      ).toHaveBeenCalledExactlyOnceWith(false);
      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
        { success: true },
      ]);
    });

    it("answers, says it's ready and starts the updater as saved", async () => {
      const s = setup();

      await load(s);

      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
        { success: true },
      ]);
      expect(s.h.notices).toEqual([
        expect.objectContaining({
          level: "info",
          source: "system",
          code: FEEDBACK_CODES.APP_LOADED,
          message: "Tokio is ready.",
        }),
      ]);
      expect(s.updaterService.initialize).toHaveBeenCalledOnce();
      expect(s.updaterService.start).toHaveBeenCalledExactlyOnceWith(false);
      expect(
        s.updaterService.initialize.mock.invocationCallOrder[0],
      ).toBeLessThan(s.updaterService.start.mock.invocationCallOrder[0]);
    });

    describe("updater", () => {
      async function callbacks() {
        const s = await live();
        const [handlers] = s.updaterService.initialize.mock.calls[0];
        if (!handlers) throw new Error("The updater got no callbacks.");
        return { s, ...handlers };
      }

      it("pushes the update status until the window is closed", async () => {
        const { s, onStatus } = await callbacks();

        onStatus?.({ state: "checking" });
        s.h.win.close();
        onStatus?.({ state: "none", checkedAt: 1 });

        expect(s.h.pushed(APP_EVENTS_RESPONSE.UPDATE_STATUS)).toEqual([
          { state: "checking" },
        ]);
      });

      it("says when an update is ready", async () => {
        const { s, onUpdate } = await callbacks();

        onUpdate?.({ state: "ready", version: "1.2.0" });

        expect(s.h.notices).toEqual([
          expect.objectContaining({
            level: "info",
            source: "system",
            code: FEEDBACK_CODES.UPDATE_READY,
            message:
              "Tokio 1.2.0 is ready. Restart from the title bar to update.",
          }),
        ]);
      });

      it("says when an update has to be downloaded", async () => {
        const { s, onUpdate } = await callbacks();

        onUpdate?.({
          state: "available",
          version: "1.2.0",
          manual: true,
          url: "https://github.com/tokio-app/tokio/releases/tag/v1.2.0",
        });

        expect(s.h.notices).toEqual([
          expect.objectContaining({
            level: "info",
            code: FEEDBACK_CODES.UPDATE_AVAILABLE,
            message:
              "Tokio 1.2.0 is available. Download it from the title bar.",
          }),
        ]);
      });

      it("tells about each version once a day", async () => {
        const { s, onUpdate } = await callbacks();
        vi.useFakeTimers();
        const versions = () => s.h.notices.map((n) => n.message.split(" ")[1]);

        onUpdate?.({ state: "ready", version: "1.2.0" });
        vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
        onUpdate?.({ state: "ready", version: "1.2.0" });
        onUpdate?.({ state: "ready", version: "1.3.0" });
        expect(versions()).toEqual(["1.2.0", "1.3.0"]);

        vi.advanceTimersByTime(1);
        onUpdate?.({ state: "ready", version: "1.2.0" });
        expect(versions()).toEqual(["1.2.0", "1.3.0", "1.2.0"]);
      });

      it("warns when an update can't be downloaded", async () => {
        const { s, onDownloadFailed } = await callbacks();

        onDownloadFailed?.(new Error("ENOSPC"));

        expect(s.h.notices).toEqual([
          expect.objectContaining({
            level: "warning",
            source: "system",
            code: FEEDBACK_CODES.UPDATE_DOWNLOAD_FAILED,
            message:
              "Unable to download the Tokio update. It will be tried again later.",
          }),
        ]);
      });
    });

    it("answers with a failure when it can't load", async () => {
      const s = setup();
      s.storeManagerService.initialize.mockRejectedValue(new Error("EPERM"));

      await load(s);

      const failure = {
        code: FEEDBACK_CODES.APP_LOAD_FAILED,
        message: "Tokio couldn't start. Check the logs folder for details.",
      };
      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
        { success: false, error: failure },
      ]);
      expect(s.h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("EPERM"),
        "system.log",
        expect.any(Error),
      );
      expect(s.updaterService.start).not.toHaveBeenCalled();
    });

    // A chat read aloud, to count the listeners LOAD_APP added
    const chatAloud = async (s: Setup) => {
      s.conn.emit(TOKIO_EVENTS.CHAT, chat("hello"));
      await vi.waitFor(() => expect(s.ttsService.talk).toHaveBeenCalled());
      await flushPromises();
    };

    it("starts the app once when the page loads again", async () => {
      const s = setup();
      s.features.tts = true;

      await load(s);
      await load(s);
      await chatAloud(s);

      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
        { success: true },
        { success: true },
      ]);
      expect(s.pathManagerService.initialize).toHaveBeenCalledOnce();
      expect(s.storeManagerService.initialize).toHaveBeenCalledOnce();
      expect(s.serverService.initEvents).toHaveBeenCalledOnce();
      expect(s.overlayService.load).toHaveBeenCalledOnce();
      expect(s.updaterService.initialize).toHaveBeenCalledOnce();
      expect(s.updaterService.start).toHaveBeenCalledOnce();
      expect(noticesFor(s, FEEDBACK_CODES.APP_LOADED)).toHaveLength(1);
      expect(s.ttsService.talk).toHaveBeenCalledOnce();
      // The reloaded window plays none of the TTS it had
      expect(s.ttsService.releaseHeld).toHaveBeenCalledOnce();
    });

    it("answers a load that comes while the app is starting once it's up", async () => {
      const s = setup();
      let started = () => {};
      s.storeManagerService.initialize.mockImplementation(
        () => new Promise<void>((done) => (started = done)),
      );

      const first = load(s);
      const second = load(s);
      await vi.waitFor(() =>
        expect(s.storeManagerService.initialize).toHaveBeenCalled(),
      );
      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([]);
      started();
      await Promise.all([first, second]);

      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
        { success: true },
        { success: true },
      ]);
      expect(s.storeManagerService.initialize).toHaveBeenCalledOnce();
      expect(s.updaterService.start).toHaveBeenCalledOnce();
    });

    it("starts again on the next load after failing, adding the listeners once", async () => {
      const s = setup();
      s.features.tts = true;
      s.overlayService.load.mockRejectedValueOnce(new Error("EBUSY"));

      await load(s);
      await load(s);
      await chatAloud(s);

      expect(s.h.replies(APP_EVENTS_RESPONSE.LOAD_APP)).toEqual([
        expect.objectContaining({ success: false }),
        { success: true },
      ]);
      expect(s.storeManagerService.initialize).toHaveBeenCalledTimes(2);
      expect(s.serverService.initEvents).toHaveBeenCalledOnce();
      expect(s.ttsService.talk).toHaveBeenCalledOnce();
      expect(s.updaterService.start).toHaveBeenCalledOnce();
    });
  });
});
