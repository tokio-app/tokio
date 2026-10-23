import { ALERT_TRIGGERS, AppSettings } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEvents,
  ChatEvent,
  CustomGift,
  EMOTE_TRIGGER,
  FEEDBACK_CODES,
  GiftEvent,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import {
  ALERTS_PATH,
  formatError,
  SERVER_PORT,
  TIMER_PATH,
} from "@/common/util";
import config from "@/config";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure } from "@/helper/feedback";
import { throttle } from "@/helper/throttle";
import Logger from "@/logger";
import { TikTokConnectorService } from "@/services/connector";
import { ACTIVITY_EVENTS } from "@/services/live";
import { TIMER_EVENTS } from "@/services/timer";
import { AppHandlerVariables } from "@/types";

const STATS_THROTTLE_MS = 250;

// Failures that repeat on every chat or event are sent at most this often.
const REPEAT_NOTICE_MS = 30_000;

// Update notices repeat on every check, once a day is enough.
const UPDATE_NOTICE_MS = 24 * 60 * 60 * 1000;

const events = createStack("system");

// Gifts in the shape overlays use, none when TikTok can't be reached.
const fetchOverlayGifts = async (
  conn: TikTokConnectorService,
): Promise<CustomGift[]> => {
  const gifts = await conn.fetchGifts();
  if (!gifts.success) return [];
  return gifts.data.map((g) => ({
    value: g.id,
    label: g.name,
    img: g.image,
    coins: g.coins,
  }));
};

// Updates are found in the background, so main tells the user about them.
const initUpdater = async ({
  updaterService: updater,
  win,
  notifier,
}: AppHandlerVariables) => {
  await updater.initialize({
    onStatus: (status) => {
      if (!win.isDestroyed()) {
        win.webContents.send(APP_EVENTS_RESPONSE.UPDATE_STATUS, status);
      }
    },
    onUpdate: (status) => {
      const options = {
        key: `update:${status.version}`,
        windowMs: UPDATE_NOTICE_MS,
      };
      if (status.state === "ready") {
        notifier.info(
          "system",
          FEEDBACK_CODES.UPDATE_READY,
          `Tokio ${status.version} is ready. Restart from the title bar to update.`,
          options,
        );
      } else {
        notifier.info(
          "system",
          FEEDBACK_CODES.UPDATE_AVAILABLE,
          `Tokio ${status.version} is available. Download it from the title bar.`,
          options,
        );
      }
    },
    onDownloadFailed: () => {
      notifier.warn(
        "system",
        FEEDBACK_CODES.UPDATE_DOWNLOAD_FAILED,
        "Unable to download the Tokio update. It will be tried again later.",
        { windowMs: UPDATE_NOTICE_MS },
      );
    },
  });
};

// Live events reach TTS, music, alerts and the UI from here. No request waits
// for them, so their failures are reported to the user directly.
const registerConnectorEvents = ({
  connectorService: conn,
  win,
  storeManagerService: store,
  ttsService: tts,
  musicService: music,
  alertsService: alerts,
  overlayService: overlays,
  liveService: live,
  pathManagerService: paths,
  notifier,
}: AppHandlerVariables) => {
  const dispatchAlert = async <K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
  ) => {
    if (!store.getActiveFeatures().alerts) return;
    const profile = await store.getProfileData();
    if (!profile) return;
    await alerts.handle(
      type,
      payload,
      profile,
      (audio) => {
        win.webContents.send(APP_EVENTS_RESPONSE.ALERT_AUDIO, audio);
      },
      (alert, error) => {
        const label = ALERT_TRIGGER_LABELS[alert.trigger.type];
        const options = {
          key: `alert:${alert.id}`,
          windowMs: REPEAT_NOTICE_MS,
        };
        if (alert.tts) {
          notifier.warn(
            "alerts",
            FEEDBACK_CODES.ALERT_TTS_FAILED,
            `Unable to speak the ${label} alert. Try another voice in Alerts.`,
            options,
          );
        } else if (
          notifier.warn(
            "alerts",
            FEEDBACK_CODES.ALERT_SOUND_MISSING,
            `The sound of the ${label} alert is missing. Pick it again in Alerts.`,
            options,
          )
        ) {
          // TTS failures are logged where they're made
          Logger.warn(
            `<Alerts> The sound of the ${label} alert is missing -- ${error}`,
            paths.files.logs.alerts,
          );
        }
      },
    );
  };

  for (const trigger of ALERT_TRIGGERS) {
    // Not a live event, AlertsService matches emote alerts on chat events.
    if (trigger === EMOTE_TRIGGER) continue;
    const listener = (d: TokioEventMap[typeof trigger]) => {
      dispatchAlert(trigger, d).catch((error) => {
        notifier.report({
          source: "alerts",
          error,
          fallback: {
            code: FEEDBACK_CODES.ALERT_FAILED,
            message: `Unable to play the ${ALERT_TRIGGER_LABELS[trigger]} alert.`,
          },
          context: trigger,
        });
      });
    };
    // Music Change alerts come once per song from the music service, whose
    // MUSIC_CHANGE also fires on queue changes. The rest from the connector.
    if (trigger === TOKIO_EVENTS.MUSIC_CHANGE) {
      music.onSongChange(listener);
    } else {
      conn.on(trigger, listener);
    }
  }

  // Busy lives send many of these, the UI only needs the latest few a second.
  const sendViews = throttle((views: number, viewers: number) => {
    win.webContents.send(APP_EVENTS_RESPONSE.VIEWS, {
      data: { views, viewers },
    });
  }, STATS_THROTTLE_MS);
  const sendLikes = throttle((likes: number) => {
    win.webContents.send(APP_EVENTS_RESPONSE.LIKES, { likes });
  }, STATS_THROTTLE_MS);

  conn.on(TOKIO_EVENTS.ROOM_USER, (d) => {
    store.updateLiveStats({ viewers: d.viewers, views: d.views });
    sendViews(d.views, d.viewers);
  });
  conn.on(TOKIO_EVENTS.LIKE, (d) => {
    store.updateLiveStats({ likes: d.totalLikes });
    sendLikes(d.totalLikes);
  });

  // The Home page's feed and totals, throttled like the stats.
  const pushSession = () => {
    win.webContents.send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: live.getSession(),
    });
  };
  const sendSession = throttle(pushSession, STATS_THROTTLE_MS);
  for (const type of ACTIVITY_EVENTS) {
    conn.on(type, (d) => {
      if (live.record(type, d)) sendSession();
    });
  }
  // Added when the app loads, before any connect, so the session has started
  // by the time the connect is answered.
  conn.on(TOKIO_EVENTS.CONNECTED, () => {
    live.start();
    sendSession.cancel();
    pushSession();
  });

  conn.on(TOKIO_EVENTS.DISCONNECTED, (d) => {
    if (d?.reason === "ended") {
      notifier.info(
        "connector",
        FEEDBACK_CODES.LIVE_ENDED,
        "The LIVE has ended.",
      );
    } else if (d?.reason === "lost") {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.CONNECTION_LOST,
        "Unable to reconnect to the LIVE. Connect again from Home.",
      );
    } else {
      notifier.info(
        "connector",
        FEEDBACK_CODES.DISCONNECTED,
        "Disconnected from the LIVE.",
      );
    }
    // A late stats update would overwrite the reset below.
    sendViews.cancel();
    sendLikes.cancel();
    sendSession.cancel();
    store.updateLiveStats({ likes: 0, viewers: 0, views: 0 });
    live.end();
    pushSession();
    music.clearHandler();
    tts.clearTalk();
    alerts.clear();
    win.webContents.send(APP_EVENTS_RESPONSE.TTS_CLEAR, undefined);
    win.webContents.send(APP_EVENTS_RESPONSE.ALERT_CLEAR, undefined);
    win.webContents.send(APP_EVENTS_RESPONSE.CONNECTED, {
      success: false,
      stats: {
        likes: 0,
        viewers: 0,
        views: 0,
      },
    });
  });
  // A drop the connector recovers from keeps the LIVE session going.
  conn.onReconnect((state) => {
    if (state === "reconnecting") {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.RECONNECTING,
        "The connection to the LIVE dropped. Reconnecting…",
        { key: "reconnect", windowMs: REPEAT_NOTICE_MS },
      );
    } else {
      notifier.info(
        "connector",
        FEEDBACK_CODES.RECONNECTED,
        "Reconnected to the LIVE.",
        { key: "reconnected", windowMs: REPEAT_NOTICE_MS },
      );
    }
  });

  const handleChat = async (d: ChatEvent) => {
    const features = store.getActiveFeatures();
    const profile = await store.getProfileData();
    if (features.tts) {
      if (!profile) return;
      tts.talk(
        d,
        profile.tts,
        (res) => {
          win.webContents.send(APP_EVENTS_RESPONSE.TTS_AUDIO, {
            id: res.id,
            data: res.data!,
            filters: res.filters,
            queueOptions: res.queueOptions,
          });
        },
        (error) => {
          // Logged once per notice, so a broken voice can't flood the log
          if (
            notifier.error(
              "tts",
              FEEDBACK_CODES.TTS_GENERATION_FAILED,
              "Unable to generate TTS audio. Try another voice, or check its engine's key in Settings.",
              { windowMs: REPEAT_NOTICE_MS },
            )
          ) {
            Logger.error(
              `<TTS> Unable to generate audio - ${formatError(error)}`,
              paths.files.logs.tts,
              error,
            );
          }
        },
      );
    } else {
      tts.clearTalk();
    }
    if (features.music && music.isActive()) {
      if (!profile) return;
      music.handle(d, profile.music);
    } else {
      music.clearHandler();
    }
  };
  conn.on(TOKIO_EVENTS.CHAT, (d) => {
    handleChat(d).catch((error) => {
      notifier.report({ source: "system", error, context: TOKIO_EVENTS.CHAT });
    });
  });

  // TikTok can't list a LIVE's emotes, so the profile keeps the ones viewers
  // use, whatever features are on.
  const recordEmotes = async (d: ChatEvent) => {
    const res = await store.recordEmotes(d.comment.emotes);
    if (!res.success) {
      // Saving logged it. The emote is tried again on its next chat.
      notifier.warn(
        "alerts",
        FEEDBACK_CODES.EMOTES_SAVE_FAILED,
        "Unable to save the LIVE's new emotes.",
        { key: "emotes", windowMs: REPEAT_NOTICE_MS },
      );
    } else if (res.data) {
      win.webContents.send(APP_EVENTS_RESPONSE.EMOTES, { data: res.data });
    }
  };
  conn.on(TOKIO_EVENTS.CHAT, (d) => {
    if (d.comment.emotes.length === 0) return;
    recordEmotes(d).catch((error) => {
      notifier.report({ source: "alerts", error, context: TOKIO_EVENTS.CHAT });
    });
  });

  // TikTok's gift list misses some gifts, like other regions' ones, so the
  // ones viewers send that aren't on it are saved for every profile,
  // whatever features are on.
  const recordGift = async (d: GiftEvent) => {
    const res = await overlays.recordGift(d.gift);
    if (!res.success) {
      // Saving logged it. The gift is tried again when it's sent again.
      notifier.warn(
        "alerts",
        FEEDBACK_CODES.GIFTS_SAVE_FAILED,
        "Unable to save the LIVE's new gifts.",
        { key: "gifts", windowMs: REPEAT_NOTICE_MS },
      );
    } else if (res.data) {
      win.webContents.send(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
        data: res.data,
      });
    }
  };
  conn.on(TOKIO_EVENTS.GIFT, (d) => {
    recordGift(d).catch((error) => {
      notifier.report({ source: "alerts", error, context: TOKIO_EVENTS.GIFT });
    });
  });

  music.onPlaybackError(() => {
    notifier.warn(
      "music",
      FEEDBACK_CODES.MUSIC_PLAYBACK_FAILED,
      "A song request couldn't be played.",
      { windowMs: REPEAT_NOTICE_MS },
    );
  });
};

// The countdown timer takes time from live events whatever features are on.
// The Tools page and the timer's overlay follow it.
const registerTimer = ({
  connectorService: conn,
  timerService: timer,
  serverService: server,
  win,
  notifier,
}: AppHandlerVariables) => {
  for (const type of TIMER_EVENTS) {
    conn.on(type, (d) => timer.handle(type, d));
  }
  conn.on(TOKIO_EVENTS.DISCONNECTED, () => {
    if (timer.disconnected()) {
      notifier.info(
        "system",
        FEEDBACK_CODES.TIMER_PAUSED,
        "The countdown timer paused, since Tokio is no longer connected to the LIVE.",
      );
    }
  });

  const overlayMessage = (added: number) => {
    const { settings, state } = timer.get();
    return {
      type: "tokio:timer",
      data: {
        ...state,
        added,
        multiplier: settings.multiplier,
        look: settings.look,
      },
    };
  };
  // Busy lives change it many times a second. The time added in between is
  // summed, and the state read when the push goes, so it's never an old one.
  let added = 0;
  const push = throttle(() => {
    const data = { ...timer.get(), added };
    if (!win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.TIMER, { success: true, data });
    }
    server.sendToClient(TIMER_PATH, overlayMessage(added));
    added = 0;
  }, STATS_THROTTLE_MS);
  timer.onChange((ms) => {
    added += ms;
    push();
  });
  server.onConnect((id) => {
    if (id === TIMER_PATH) server.sendToClient(TIMER_PATH, overlayMessage(0));
  });
};

events.push(
  APP_EVENTS.GET_PROFILE,
  async ({ storeManagerService }, e) => {
    const profile = await storeManagerService.getProfileData();
    const profiles = storeManagerService.getProfiles();
    if (!profile || !profiles)
      throw new Error("The active profile is missing.");

    e.reply(APP_EVENTS_RESPONSE.GET_PROFILE, {
      success: true,
      profile,
      profiles,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
      message: "Unable to load the profile.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_PROFILE),
  },
);

// The renderer sends LOAD_APP each time its page loads, also on a reload in
// development. Every one is answered, but the app starts once, so listeners
// and the updater aren't added again.
const started = new WeakMap<AppHandlerVariables, Promise<AppSettings>>();
// Listeners stay added when a start that failed is tried again
const wired = new WeakSet<AppHandlerVariables>();

// Sets up the services and starts the server.
const startApp = async (handler: AppHandlerVariables) => {
  const {
    app,
    storeManagerService,
    pathManagerService,
    connectorService,
    ttsService,
    musicService,
    serverService,
    overlayService,
    urlManagerService,
    jsonManagerService,
    yamlManagerService,
    alertsService,
    licensesService,
    updaterService,
    liveService,
    timerService,
    notifier,
  } = handler;

  await pathManagerService.initialize(
    app.getPath("home"),
    config.APP.folderName,
    ({ files, folders }) => {
      connectorService.setLogFile(files.logs.connector);
      ttsService.setLogFile(files.logs.tts);
      serverService.setLogFile(files.logs.server);
      overlayService.setLogFile(files.logs.overlays);
      urlManagerService.setLogFile(files.logs.system);
      storeManagerService.setLogFile(files.logs.system);
      jsonManagerService.setLogFile(files.logs.system);
      alertsService.setLogFile(files.logs.alerts);
      musicService.setLogFile(files.logs.music);
      licensesService.setLogFile(files.logs.system);
      updaterService.setLogFile(files.logs.system);
      liveService.setLogFile(files.logs.connector);
      timerService.setLogFile(files.logs.system);
      notifier.setLogFiles(files.logs);
      alertsService.setSoundsFolder(folders.soundsFolder);
      alertsService.setMediaFolder(folders.mediaFolder);
      alertsService.setSpeaker(ttsService);
      alertsService.setServer(serverService);
      // Not an overlay: the alerts' images and videos, for their overlay pages
      serverService.mount(`${ALERTS_PATH}/media`, folders.mediaFolder);
    },
  );
  await storeManagerService.initialize(
    config.DB.name,
    {
      connector: connectorService,
      tts: ttsService,
    },
    jsonManagerService,
    pathManagerService,
  );
  timerService.initialize({ store: storeManagerService });
  overlayService.initialize(
    {
      folder: pathManagerService.folders.overlaysFolder,
      giftsFile: pathManagerService.files.gifts,
      customGiftsFile: pathManagerService.files.customGifts,
    },
    {
      yaml: yamlManagerService,
      json: jsonManagerService,
      server: serverService,
      store: storeManagerService,
    },
  );
  storeManagerService.updateLiveStats({
    likes: 0,
    viewers: 0,
    views: 0,
  });
  if (!wired.has(handler)) {
    wired.add(handler);
    serverService.initEvents(connectorService, musicService);
    registerConnectorEvents(handler);
    registerTimer(handler);
  }

  const settings = storeManagerService.getSettings();
  liveService.setFeed(settings.activityFeed);
  const profile = await storeManagerService.getProfileData();
  if (profile) timerService.load(profile.timer, settings.activeProfile.file);

  // Before the server starts, so it serves the overlays right away. The
  // gifts saved last time are used when there are any, so startup doesn't
  // wait for TikTok, and fresh ones replace them once they arrive.
  const cachedGifts = await overlayService.getGifts();
  if (cachedGifts.length > 0) {
    await overlayService.load(cachedGifts);
    void fetchOverlayGifts(connectorService)
      .then(async (gifts) => {
        if (gifts.length > 0) await overlayService.refreshGifts(gifts);
      })
      .catch((error) => {
        notifier.report({
          source: "overlays",
          error: new AppFailure(
            FEEDBACK_CODES.GIFTS_FETCH_FAILED,
            "Unable to update the gifts from TikTok. Overlays use the ones saved last time.",
            { level: "warning", cause: error },
          ),
        });
      });
  } else {
    const gifts = await fetchOverlayGifts(connectorService);
    if (gifts.length === 0) {
      notifier.warn(
        "overlays",
        FEEDBACK_CODES.GIFTS_FETCH_FAILED,
        "Unable to get the gifts from TikTok. Overlay gift options stay empty until the next start.",
      );
    }
    await overlayService.load(gifts);
  }

  // A taken port shouldn't stop the app, the server is turned off instead.
  if (!(await serverService.toggleServer(settings.server.enabled))) {
    notifier.report({
      source: "server",
      error: new AppFailure(
        FEEDBACK_CODES.SERVER_START_FAILED,
        `The overlay server couldn't start, port ${SERVER_PORT} may be in use. It has been turned off.`,
        { level: "warning" },
      ),
    });
    await storeManagerService.updateServerSettings(false);
  }

  return settings;
};

events.push(
  APP_EVENTS.LOAD_APP,
  async (handler, e) => {
    let start = started.get(handler);
    const first = start === undefined;
    if (!start) {
      const attempt = startApp(handler);
      start = attempt;
      started.set(handler, attempt);
      // The next load tries again
      attempt.catch(() => {
        if (started.get(handler) === attempt) started.delete(handler);
      });
    }
    const settings = await start;

    e.reply(APP_EVENTS_RESPONSE.LOAD_APP, {
      success: true,
    });
    if (!first) {
      // The window reloaded, dropping the TTS it was playing
      handler.ttsService.releaseHeld();
      return;
    }

    await initUpdater(handler);
    handler.updaterService.start(settings.updates.auto);
  },
  {
    failure: {
      code: FEEDBACK_CODES.APP_LOAD_FAILED,
      message: "Tokio couldn't start. Check the logs folder for details.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.LOAD_APP),
  },
);

export default events;
