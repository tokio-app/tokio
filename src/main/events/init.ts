import { ALERT_TRIGGERS } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEvents,
  ChatEvent,
  CustomGift,
  EMOTE_TRIGGER,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { SERVER_PORT } from "@/common/util";
import config from "@/config";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure } from "@/helper/feedback";
import { TikTokConnectorService } from "@/services/connector";
import { AppHandlerVariables } from "@/types";
import { throttle } from "es-toolkit";

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
      (alert) => {
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
        } else {
          notifier.warn(
            "alerts",
            FEEDBACK_CODES.ALERT_SOUND_MISSING,
            `The sound of the ${label} alert is missing. Pick it again in Alerts.`,
            options,
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
    // MUSIC_CHANGE comes from the music service, the rest from the connector.
    if (trigger === TOKIO_EVENTS.MUSIC_CHANGE) {
      music.on(trigger, listener);
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
  conn.on(TOKIO_EVENTS.DISCONNECTED, (d) => {
    if (d?.reason === "ended") {
      notifier.info(
        "connector",
        FEEDBACK_CODES.LIVE_ENDED,
        "The LIVE has ended.",
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
    music.clearHandler();
    tts.clearTalk();
    alerts.clearSpeech();
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
            data: res.data!,
            filters: res.filters,
            queueOptions: res.queueOptions,
          });
        },
        () => {
          notifier.error(
            "tts",
            FEEDBACK_CODES.TTS_GENERATION_FAILED,
            "Unable to generate TTS audio. Try another voice on the TTS page.",
            { windowMs: REPEAT_NOTICE_MS },
          );
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

  music.onPlaybackError(() => {
    notifier.warn(
      "music",
      FEEDBACK_CODES.MUSIC_PLAYBACK_FAILED,
      "A song request couldn't be played and was skipped.",
    );
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

events.push(
  APP_EVENTS.LOAD_APP,
  async (handler, e) => {
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
        notifier.setLogFiles(files.logs);
        alertsService.setSoundsFolder(folders.soundsFolder);
        alertsService.setSpeaker(ttsService);
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
    overlayService.initialize(
      {
        folder: pathManagerService.folders.overlaysFolder,
        giftsFile: pathManagerService.files.gifts,
      },
      {
        yaml: yamlManagerService,
        json: jsonManagerService,
        server: serverService,
        store: storeManagerService,
      },
    );
    serverService.initEvents(connectorService, musicService);
    storeManagerService.updateLiveStats({
      likes: 0,
      viewers: 0,
      views: 0,
    });
    registerConnectorEvents(handler);

    const settings = storeManagerService.getSettings();

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

    e.reply(APP_EVENTS_RESPONSE.LOAD_APP, {
      success: true,
    });
    notifier.info("system", FEEDBACK_CODES.APP_LOADED, "Tokio is ready.");

    await initUpdater(handler);
    updaterService.start(settings.updates.auto);
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
