import { DEFAULT_LANGUAGE, listOf, translate } from "@/common/i18n";
import {
  ALERT_TRIGGERS,
  AppSettings,
  CatalogOverlay,
  GOAL_TRIGGER,
} from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEvents,
  ChatEvent,
  EMOTE_TRIGGER,
  FEEDBACK_CODES,
  GiftEvent,
  MINECRAFT_CONNECT_COMMANDS,
  MINECRAFT_EDITION_NAMES,
  Platform,
  PLATFORMS,
  TOKIO_EVENTS,
  TokioEventMap,
  TokioPayload,
} from "@/common/types";
import {
  ALERTS_PATH,
  EMPTY_LIVE_STATS,
  compareVersions,
  formatError,
  STUDIO_SOCKET_PREFIX,
  GAMES_PATH,
  MINECRAFT_PICTURES_PATH,
  MINECRAFT_PORT,
  SERVER_PORT,
  PLATFORM_LABELS,
  TIMER_PATH,
  timerTriggers,
} from "@/common/util";
import config from "@/config";
import { globalShortcut, systemPreferences } from "electron";
import { profileReply } from "@/events/pages/settings";
import { connectionState, createStack, replyFailure } from "@/helper/events";
import { AppFailure, REPEAT_NOTICE_MS, saveFailure } from "@/helper/feedback";
import { sendGamesOverlay, sendGamesRun } from "@/helper/games";
import {
  fetchOverlayGifts,
  giftsFetched,
  refreshTikTokGifts,
  usesTikTok,
} from "@/helper/gifts";
import { language, onLanguage, setLanguage, t } from "@/helper/i18n";
import {
  liveNumbers,
  sendStudioOverlay,
  sendStudioOverlays,
  sendStudioReact,
  showsNumbers,
  showsUptime,
} from "@/helper/studio";
import { applyStoredShortcuts, warnTaken } from "@/helper/shortcuts";
import { throttle } from "@/helper/throttle";
import Logger from "@/logger";
import { createMcpRoutes } from "@/mcp";
import type { AlertAudio } from "@/services/alerts";
import { FAN_EVENTS } from "@/services/fans";
import { MAX_BACKLOG } from "@/services/games";
import { HISTORY_EVENTS } from "@/services/history";
import { ACTIVITY_EVENTS } from "@/services/live";
import { OverlayUpdates } from "@/services/overlay";
import {
  createRemoteRoutes,
  remoteLabels,
  remoteState,
} from "@/services/server/remote";
import { TIMER_EVENTS } from "@/services/timer";
import { chatCommands } from "@/services/translation/commands";
import { reasonKey } from "@/services/translation/common";
import { failureKey, TTSRequestError } from "@/services/tts/common";
import { AppHandlerVariables } from "@/types";
import express from "express";
import { release } from "node:os";

const STATS_THROTTLE_MS = 250;

// Overlays get the fans at most this often while a LIVE adds them
const FANS_PUSH_MS = 5000;
// And they're saved this often while they change
const FANS_SAVE_MS = 30_000;

// Overlays get the top gifters at most this often while gifts come in
const GIFTERS_PUSH_MS = 1000;
// And the LIVE in progress is saved this often while it changes
const HISTORY_SAVE_MS = 30_000;

// Update notices repeat on every check, once a day is enough.
const UPDATE_NOTICE_MS = 24 * 60 * 60 * 1000;

const events = createStack("system");

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
          t("main.init.updateReady", { version: status.version }),
          options,
        );
      } else {
        notifier.info(
          "system",
          FEEDBACK_CODES.UPDATE_AVAILABLE,
          t("main.init.updateAvailable", { version: status.version }),
          options,
        );
      }
    },
    onDownloadFailed: () => {
      notifier.warn(
        "system",
        FEEDBACK_CODES.UPDATE_DOWNLOAD_FAILED,
        t("main.init.updateDownloadFailed"),
        { windowMs: UPDATE_NOTICE_MS },
      );
    },
  });
};

// Official overlays update in the background, so main tells the user what
// changed and what waits for them.
const reportOverlayUpdates = (
  { overlayService, win, notifier }: AppHandlerVariables,
  { updated, breaking, failed, saved }: OverlayUpdates,
) => {
  const names = (entries: CatalogOverlay[]) =>
    listOf(
      language(),
      entries.map((o) => o.name),
    );

  if (updated.length > 0) {
    // Pages showing the overlays get the new versions
    if (!win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
        success: true,
        data: overlayService.getOverlays(),
      });
    }
    notifier.info(
      "overlays",
      FEEDBACK_CODES.OVERLAYS_UPDATED,
      t("main.overlays.autoUpdated", {
        count: updated.length,
        names: names(updated),
      }),
    );
  }
  // Once a day each, as every pass finds them again
  for (const { id, name, version } of breaking) {
    notifier.info(
      "overlays",
      FEEDBACK_CODES.OVERLAY_UPDATE_WAITING,
      t("main.overlays.updateWaiting", {
        name,
        version,
        official: t("overlays.official.title"),
      }),
      { key: `overlay-update:${id}@${version}`, windowMs: UPDATE_NOTICE_MS },
    );
  }
  // installFromCatalog logged why
  if (failed.length > 0) {
    notifier.warn(
      "overlays",
      FEEDBACK_CODES.OVERLAY_UPDATE_FAILED,
      t("main.overlays.autoUpdateFailed", {
        count: failed.length,
        names: names(failed),
      }),
      // Its own key, so a failed Update click still gets its notice
      { key: "overlay-update:failed", windowMs: UPDATE_NOTICE_MS },
    );
  }
  if (!saved) notifier.report({ source: "overlays", error: saveFailure() });
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
  gamesService: games,
  studioService: studio,
  overlayService: overlays,
  liveService: live,
  historyService: history,
  pathManagerService: paths,
  serverService: server,
  controlsService: controls,
  ratesService: rates,
  notifier,
}: AppHandlerVariables) => {
  const dispatchAlert = async <K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
  ) => {
    // Ignored while paused, and never played later
    if (controls.isPaused()) return;
    if (!store.getActiveFeatures().alerts) return;
    const profile = await store.getProfileData();
    if (!profile) return;
    // This event's sounds, media and spoken messages, which a replay plays
    const group: AlertAudio[] = [];
    await alerts.handle(
      type,
      payload,
      profile,
      (audio) => {
        // A spoken message made after a pause came
        if (controls.isPaused()) return;
        // Kept by reference, so the messages made later join it
        if (group.push(audio) === 1) controls.recordAlerts(group);
        // A sound read or a message made after the window closed on quit
        if (win.isDestroyed()) return;
        win.webContents.send(APP_EVENTS_RESPONSE.ALERT_AUDIO, audio);
      },
      (alert, error, row) => {
        // The row that fired: an Or row can differ from the alert's first
        const label = t(ALERT_TRIGGER_LABELS[row.type]);
        // Logs stay English
        const logged = translate(
          DEFAULT_LANGUAGE,
          ALERT_TRIGGER_LABELS[row.type],
        );
        const options = {
          key: `alert:${alert.id}`,
          windowMs: REPEAT_NOTICE_MS,
        };
        // Logged only when the notice goes out, so a failing engine or a
        // missing file can't flood the log on every event
        if (alert.tts) {
          if (
            notifier.warn(
              "alerts",
              FEEDBACK_CODES.ALERT_TTS_FAILED,
              t("main.init.alertTtsFailed", { label, alerts: t("nav.alerts") }),
              options,
            )
          ) {
            Logger.error(
              `<Alerts> Unable to speak the ${logged} alert -- ${error}`,
              paths.files.logs.alerts,
            );
          }
        } else if (
          notifier.warn(
            "alerts",
            FEEDBACK_CODES.ALERT_SOUND_MISSING,
            t("main.init.alertSoundMissing", {
              label,
              alerts: t("nav.alerts"),
            }),
            options,
          )
        ) {
          Logger.warn(
            `<Alerts> The sound of the ${logged} alert is missing -- ${error}`,
            paths.files.logs.alerts,
          );
        }
      },
    );
  };

  // Whatever features are on: games run while their connection is on.
  const dispatchGames = async <K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
  ) => {
    // The pause dropped the waiting runs, and takes no new ones
    if (controls.isPaused()) return;
    const profile = await store.getProfileData();
    if (!profile) return;
    await games.handle(type, payload, profile.games);
  };

  for (const trigger of ALERT_TRIGGERS) {
    // Not a live event, the services match emote triggers on chat events.
    if (trigger === EMOTE_TRIGGER) continue;
    const listener = (d: TokioEventMap[typeof trigger]) => {
      const label = t(ALERT_TRIGGER_LABELS[trigger]);
      dispatchAlert(trigger, d).catch((error) => {
        notifier.report({
          source: "alerts",
          error,
          fallback: {
            code: FEEDBACK_CODES.ALERT_FAILED,
            message: t("main.init.alertFailed", { label }),
          },
          context: trigger,
        });
      });
      dispatchGames(trigger, d).catch((error) => {
        notifier.report({
          source: "games",
          error,
          fallback: {
            code: FEEDBACK_CODES.GAME_ACTION_FAILED,
            message: t("main.init.gameActionFailed", { label }),
          },
          context: trigger,
        });
      });
    };
    // Music change alerts come once per song from the music service, whose
    // MUSIC_CHANGE also fires on queue changes. The rest from the connector.
    if (trigger === TOKIO_EVENTS.MUSIC_CHANGE) {
      music.onSongChange(listener);
    } else {
      conn.on(trigger, listener);
    }
  }

  // Busy lives send many of these, the UI only needs the latest few a second.
  // A throttled push can come after the window closed on quit.
  const sendViews = throttle(
    (
      views: number,
      viewers: number,
      platformViewers: Partial<Record<Platform, number>>,
    ) => {
      if (win.isDestroyed()) return;
      win.webContents.send(APP_EVENTS_RESPONSE.VIEWS, {
        data: { views, viewers, platformViewers },
      });
    },
    STATS_THROTTLE_MS,
  );
  const sendLikes = throttle((likes: number) => {
    if (win.isDestroyed()) return;
    win.webContents.send(APP_EVENTS_RESPONSE.LIKES, { likes });
  }, STATS_THROTTLE_MS);

  // TikTok sometimes lowers the total for a while, so the most seen is kept
  let likes = 0;
  conn.on(TOKIO_EVENTS.LIKE, (d) => {
    likes = Math.max(likes, d.totalLikes);
    store.updateLiveStats({ likes });
    sendLikes(likes);
  });

  // The Home page's feed and totals, throttled like the stats.
  const pushSession = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: live.getSession(),
    });
  };
  const sendSession = throttle(pushSession, STATS_THROTTLE_MS);
  // Home's chart gets the session again as each minute of viewers ends
  conn.on(TOKIO_EVENTS.ROOM_USER, (d) => {
    store.updateLiveStats({ viewers: d.viewers, views: d.views });
    // The room adds up the platforms' viewers; Home also shows each one's
    const platformViewers = conn.viewers();
    sendViews(d.views, d.viewers, platformViewers);
    if (live.recordViewers(d.viewers, platformViewers)) sendSession();
  });
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
    // So YouTube's Super Chats show in dollars from the first one
    if (conn.status().youtube) void rates.refresh();
  });
  // The Super Chats' dollars once the rates load
  rates.onChange(() => sendSession());

  // What Home and the title bar show, as main holds it
  const pushConnection = () => {
    // The connection goes on reconnecting after the window closed on quit
    if (win.isDestroyed()) return;
    win.webContents.send(
      APP_EVENTS_RESPONSE.CONNECTED,
      connectionState({
        connectorService: conn,
        liveService: live,
        storeManagerService: store,
      }),
    );
  };

  conn.on(TOKIO_EVENTS.DISCONNECTED, (d) => {
    // After an abnormal stop TikTok looks for its LIVE again, which says
    // nothing about another platform's end
    const by = conn.endedBy();
    const waiting = by === "tiktok" && conn.isWaiting();
    if (d?.reason === "lost" && by === "twitch") {
      // Twitch's lost is always its sign-out
      notifier.warn(
        "connector",
        FEEDBACK_CODES.CONNECTION_LOST,
        t("main.home.connect.twitchBadKey", { settings: t("nav.settings") }),
      );
    } else if (d?.reason === "ended") {
      notifier.info(
        "connector",
        FEEDBACK_CODES.LIVE_ENDED,
        t(waiting ? "main.init.liveEndedAway" : "main.init.liveEnded"),
      );
    } else if (d?.reason === "lost") {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.CONNECTION_LOST,
        waiting
          ? t("main.init.connectionLostLooking")
          : t("main.init.connectionLost", { home: t("nav.home") }),
      );
    } else {
      notifier.info(
        "connector",
        FEEDBACK_CODES.DISCONNECTED,
        t("main.init.disconnected"),
      );
    }
    // A late stats update would overwrite the reset below.
    sendViews.cancel();
    sendLikes.cancel();
    sendSession.cancel();
    likes = 0;
    store.updateLiveStats(EMPTY_LIVE_STATS);
    live.end();
    pushSession();
    music.clearHandler();
    tts.clearTalk();
    alerts.clear();
    // The connection stops on quit too, after the window closed
    if (!win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.TTS_CLEAR, undefined);
      win.webContents.send(APP_EVENTS_RESPONSE.ALERT_CLEAR, undefined);
    }
    pushConnection();
  });
  // A drop the connector recovers from keeps the LIVE session going. A LIVE
  // found again after a stop started a new one with CONNECTED. With other
  // platforms on, the notices name the platform, each keyed apart.
  conn.onReconnect((state, platform) => {
    const several = new Set([...Object.keys(conn.status()), platform]).size > 1;
    const params = { platform: PLATFORM_LABELS[platform] };
    const key = (name: string) => (several ? `${name}:${platform}` : name);
    if (state === "reconnecting") {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.RECONNECTING,
        several
          ? t("main.init.reconnectingOn", params)
          : t("main.init.reconnecting"),
        { key: key("reconnect"), windowMs: REPEAT_NOTICE_MS },
      );
    } else if (state === "reconnected") {
      notifier.info(
        "connector",
        FEEDBACK_CODES.RECONNECTED,
        several
          ? t("main.init.reconnectedOn", params)
          : t("main.init.reconnected"),
        { key: key("reconnected"), windowMs: REPEAT_NOTICE_MS },
      );
    } else {
      // Only after an abnormal stop, so never after a LIVE ended on purpose
      const home = t("nav.home");
      notifier.warn(
        "connector",
        FEEDBACK_CODES.RECONNECT_FAILED,
        several
          ? t("main.init.connectionLostOn", { ...params, home })
          : t("main.init.connectionLost", { home }),
        several ? { key: `stopped:${platform}` } : undefined,
      );
    }
    pushConnection();
  });
  // A platform up or down while the session goes on with the others. Coming
  // up says nothing: its connect or its reconnect already did.
  conn.onPlatform((platform, change) => {
    if (platform === "youtube" && change === "up") void rates.refresh();
    // LIVE history lists the LIVE under it, even if it sends nothing
    if (change === "up") history.join(platform);
    const params = { platform: PLATFORM_LABELS[platform] };
    // Apart from the session's own, which can come right after
    const options = { key: `${change}:${platform}` };
    // After an abnormal stop the connector looks for its LIVE again
    const waiting = conn.status()[platform] === "waiting";
    if (change === "ended") {
      notifier.info(
        "connector",
        FEEDBACK_CODES.LIVE_ENDED,
        waiting
          ? t("main.init.platformEndedAway", params)
          : t("main.init.platformEnded", params),
        options,
      );
    } else if (change === "lost") {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.CONNECTION_LOST,
        // Twitch's lost is always its sign-out
        platform === "twitch"
          ? t("main.home.connect.twitchBadKey", { settings: t("nav.settings") })
          : waiting
            ? t("main.init.platformLostLooking", params)
            : t("main.init.connectionLostOn", {
                ...params,
                home: t("nav.home"),
              }),
        options,
      );
    } else if (change === "stopped") {
      notifier.info(
        "connector",
        FEEDBACK_CODES.DISCONNECTED,
        t("main.init.platformStopped", params),
        options,
      );
    }
    pushConnection();
  });
  // Each sign-in, sign-out and refresh's new token is saved before Twitch's
  // provider uses it. The store logged a failed save.
  conn.onTwitchAccount(async (account) => {
    const saved = await store.updateTwitchAccount(account);
    if (!saved) {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.TWITCH_TOKEN_SAVE_FAILED,
        t("main.init.twitchTokenSaveFailed"),
        { key: "twitch-token", windowMs: REPEAT_NOTICE_MS },
      );
    }
    // Twitch revoked the access or refused the refresh: the window shows it
    // signed out, as Settings' Sign out does
    if (!account.key && !win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, {
        success: true,
        login: "",
      });
    }
    return saved;
  });

  const handleChat = async (d: ChatEvent) => {
    // Before the else branches below, whose clearHandler would empty the
    // song queue the pause lets play on
    if (controls.isPaused()) return;
    const features = store.getActiveFeatures();
    const profile = await store.getProfileData();
    if (features.tts) {
      if (!profile) return;
      tts.talk(
        d,
        profile.tts,
        (res) => {
          // A message made after the window closed on quit
          if (win.isDestroyed()) return;
          win.webContents.send(APP_EVENTS_RESPONSE.TTS_AUDIO, {
            id: res.id,
            data: res.data!,
            filters: res.filters,
            queueOptions: res.queueOptions,
          });
        },
        (error) => {
          // Says why when the engine told, like no credits left
          const key = failureKey(error) ?? "main.init.ttsFailed";
          const engine = error instanceof TTSRequestError ? error.engine : "";
          // Logged once per notice, so a broken voice can't flood the log
          if (
            notifier.error(
              "tts",
              FEEDBACK_CODES.TTS_GENERATION_FAILED,
              t(key, { engine, settings: t("nav.settings") }),
              // Not the TTS page's key, so its Test still says why it failed
              { key: "tts:chat", windowMs: REPEAT_NOTICE_MS },
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
      music.handle(d, profile.music, profile.connector.username);
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
        t("main.init.emotesSaveFailed"),
        { key: "emotes", windowMs: REPEAT_NOTICE_MS },
      );
    } else if (res.data) {
      if (!win.isDestroyed()) {
        win.webContents.send(APP_EVENTS_RESPONSE.EMOTES, { data: res.data });
      }
      // The games overlay's rows with that emote get its picture
      await sendGamesOverlay({
        storeManagerService: store,
        overlayService: overlays,
        serverService: server,
        pathManagerService: paths,
      });
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
        t("main.init.giftsSaveFailed"),
        { key: "gifts", windowMs: REPEAT_NOTICE_MS },
      );
    } else if (res.data) {
      if (!win.isDestroyed()) {
        win.webContents.send(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
          data: res.data,
        });
      }
      // The games overlay's rows with that gift get its picture and name
      await sendGamesOverlay({
        storeManagerService: store,
        overlayService: overlays,
        serverService: server,
        pathManagerService: paths,
      });
      // And so do studio elements that show it
      await sendStudioOverlays({
        storeManagerService: store,
        overlayService: overlays,
        serverService: server,
        pathManagerService: paths,
        liveService: live,
        studioService: studio,
        historyService: history,
      });
    }
  };
  conn.on(TOKIO_EVENTS.GIFT, (d) => {
    recordGift(d).catch((error) => {
      notifier.report({ source: "alerts", error, context: TOKIO_EVENTS.GIFT });
    });
  });

  // Home's now playing gets the queue as overlays do, on every change
  music.on(TOKIO_EVENTS.MUSIC_CHANGE, (songs) => {
    if (win.isDestroyed()) return;
    win.webContents.send(APP_EVENTS_RESPONSE.SONGS, { data: songs });
  });

  music.onPlaybackError((id, error) => {
    // Logged once per notice, so a broken player can't flood the log
    if (
      notifier.warn(
        "music",
        FEEDBACK_CODES.MUSIC_PLAYBACK_FAILED,
        t("main.init.musicPlaybackFailed"),
        { windowMs: REPEAT_NOTICE_MS },
      )
    ) {
      Logger.error(
        `<Music> Unable to play track [${id}] -- ${formatError(error)}`,
        paths.files.logs.music,
        error,
      );
    }
  });
};

// The Games page follows the connections, and their failures become notices.
// The games overlay lights an action's row on each run.
const registerGames = (handler: AppHandlerVariables) => {
  const {
    connectorService: conn,
    gamesService: games,
    storeManagerService: store,
    pathManagerService: paths,
    win,
    notifier,
  } = handler;
  games.onStatus((status) => {
    if (win.isDestroyed()) return;
    win.webContents.send(APP_EVENTS_RESPONSE.GAMES, {
      success: true,
      data: { settings: store.getSettings().games, status },
    });
  });
  // Logged once per notice, as they can repeat on every event
  games.onError((action, { offline, full, message }) => {
    const label = t(ALERT_TRIGGER_LABELS[action.trigger.type]);
    // Logs stay English
    const logged = translate(
      DEFAULT_LANGUAGE,
      ALERT_TRIGGER_LABELS[action.trigger.type],
    );
    if (full) {
      if (
        notifier.warn(
          "games",
          FEEDBACK_CODES.GAME_BACKLOG_FULL,
          t("main.init.gameBacklogFull", { label, max: String(MAX_BACKLOG) }),
          { key: `game:${action.id}:full`, windowMs: REPEAT_NOTICE_MS },
        )
      ) {
        Logger.warn(
          `<Games> The ${logged} action has ${MAX_BACKLOG} runs waiting, new ones are skipped.`,
          paths.files.logs.games,
        );
      }
    } else if (offline) {
      // Named by edition: the other one may be connected
      const game = `Minecraft ${MINECRAFT_EDITION_NAMES[action.edition]}`;
      const connect = MINECRAFT_CONNECT_COMMANDS[action.edition];
      if (
        notifier.warn(
          "games",
          FEEDBACK_CODES.GAME_NOT_CONNECTED,
          t("main.init.gameNotConnected", {
            game,
            label,
            connect,
            games: t("nav.games"),
          }),
          { key: "game:minecraft:offline", windowMs: 60_000 },
        )
      ) {
        Logger.warn(
          `<Games> The ${logged} action didn't run, ${game} isn't connected.`,
          paths.files.logs.games,
        );
      }
    } else if (
      notifier.warn(
        "games",
        FEEDBACK_CODES.GAME_COMMAND_FAILED,
        t("main.init.gameCommandFailed", { label, message }),
        { key: `game:${action.id}`, windowMs: REPEAT_NOTICE_MS },
      )
    ) {
      Logger.warn(
        `<Games> A command of the ${logged} action failed -- ${message}`,
        paths.files.logs.games,
      );
    }
  });
  // Gift streaks' ends may be missed
  conn.on(TOKIO_EVENTS.DISCONNECTED, () => games.clear());

  games.onRun((action) => sendGamesRun(handler, action.id));
  handler.serverService.onConnect((id) => {
    if (id === GAMES_PATH) void sendGamesOverlay(handler);
  });
  // Its automatic texts are in the app's language
  onLanguage(() => void sendGamesOverlay(handler));
};

// The pause lives in memory, and the window follows it. A new LIVE never
// starts paused.
const registerControls = ({
  connectorService: conn,
  controlsService: controls,
  win,
}: AppHandlerVariables) => {
  conn.on(TOKIO_EVENTS.CONNECTED, () => controls.setPaused(false));
  controls.onChange((state) => {
    if (win.isDestroyed()) return;
    win.webContents.send(APP_EVENTS_RESPONSE.CONTROLS, state);
  });
};

// The countdown timer takes time from live events whatever features are on.
// Tools and the timer's overlay follow it.
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
        t("main.init.timerPaused"),
      );
    }
  });
  // Saving logged it. The timer is tried again on the next interval.
  timer.onSaveFailed(() =>
    notifier.warn(
      "system",
      FEEDBACK_CODES.TIMER_SAVE_FAILED,
      t("main.init.timerSaveFailed"),
      { key: "timer", windowMs: REPEAT_NOTICE_MS },
    ),
  );

  const overlayMessage = (added: number) => {
    const { settings, state } = timer.get();
    return {
      type: "tokio:timer",
      data: {
        ...state,
        added,
        multiplier: settings.multiplier,
        look: settings.look,
        // The carousel's items, none while it's off
        triggers: settings.look.show_triggers
          ? timerTriggers(settings, language(), timer.platforms())
          : [],
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
  // The carousel's automatic names are in the app's language
  onLanguage(() => server.sendToClient(TIMER_PATH, overlayMessage(0)));
};

// Overlay Studio's elements react to live events whatever features are on,
// and its texts follow the live numbers. Registered after
// registerConnectorEvents: the connector runs its listeners in order, so the
// stats and the LIVE session already hold an event when these read them.
const registerStudio = (handler: AppHandlerVariables) => {
  const {
    connectorService: conn,
    musicService: music,
    storeManagerService: store,
    studioService: studio,
    serverService: server,
    liveService: live,
    historyService: history,
    ratesService: rates,
    notifier,
  } = handler;

  // Busy lives change them many times a second; the views are made when the
  // push goes, so they're never old ones. The goals reached react first.
  const sendNumbers = throttle(() => {
    try {
      studio.goals(store.getStudio(), () => liveNumbers(handler));
    } catch (error) {
      notifier.report({
        source: "overlays",
        error,
        fallback: {
          code: FEEDBACK_CODES.STUDIO_FAILED,
          message: t("main.init.studioFailed", {
            label: t("studio.goal.trigger"),
          }),
        },
        context: GOAL_TRIGGER,
      });
    }
    void sendStudioOverlays(handler, showsNumbers);
  }, STATS_THROTTLE_MS);

  for (const trigger of ALERT_TRIGGERS) {
    // Not a live event, the service matches emote triggers on chat events.
    if (trigger === EMOTE_TRIGGER) continue;
    // One listener for both: GIFT and CHAT have many already
    const listener = (d: TokioEventMap[typeof trigger]) => {
      try {
        studio.handle(trigger, d, store.getStudio(), () =>
          liveNumbers(handler),
        );
      } catch (error) {
        notifier.report({
          source: "overlays",
          error,
          fallback: {
            code: FEEDBACK_CODES.STUDIO_FAILED,
            message: t("main.init.studioFailed", {
              label: t(ALERT_TRIGGER_LABELS[trigger]),
            }),
          },
          context: trigger,
        });
      }
      // A counter can count any of them
      sendNumbers();
    };
    // Once per song, as alerts take it
    if (trigger === TOKIO_EVENTS.MUSIC_CHANGE) {
      music.onSongChange(listener);
    } else {
      conn.on(trigger, listener);
    }
  }
  conn.on(TOKIO_EVENTS.ROOM_USER, () => sendNumbers());
  // A list of top gifters follows this LIVE's
  history.onChange(() => sendNumbers());
  // The Super Chats' dollars
  rates.onChange(() => sendNumbers());
  conn.on(TOKIO_EVENTS.CONNECTED, () => {
    studio.startLive();
    sendNumbers();
  });
  conn.on(TOKIO_EVENTS.DISCONNECTED, () => {
    // Gift streaks' ends may be missed; counters and goals start again
    studio.clear();
    // A late push would show the LIVE's numbers over the zeros
    sendNumbers.cancel();
    void sendStudioOverlays(handler, showsNumbers);
  });

  // shortcut: a view a second for each overlay that shows {uptime}, not a
  // clock on the page, since OBS on another PC has its own. Upgrade to a
  // start time in the view if overlays that show it get heavy.
  setInterval(() => {
    if (live.startedAt === null) return;
    void sendStudioOverlays(handler, showsUptime);
  }, 1000).unref();

  studio.onReact((id, react) => sendStudioReact(handler, id, react));
  server.onConnect((id) => {
    if (id.startsWith(STUDIO_SOCKET_PREFIX)) {
      void sendStudioOverlay(handler, id.slice(STUDIO_SOCKET_PREFIX.length));
    }
  });
  // Their numbers are in the app's language
  onLanguage(() => void sendStudioOverlays(handler));
};

// The main window captures the cameras studio pages show
const registerCameras = ({
  serverService: server,
  win,
}: AppHandlerVariables) => {
  let asked = false;
  server.onCameras((captures) => {
    if (!win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.CAMERAS, { captures });
    }
    // macOS asks the user once. Not awaited: the window tries again.
    if (asked || process.platform !== "darwin") return;
    if (captures.length === 0) return;
    if (systemPreferences.getMediaAccessStatus("camera") !== "not-determined") {
      return;
    }
    asked = true;
    void systemPreferences.askForMediaAccess("camera");
  });
  server.onCameraKeyframe((id) => {
    if (!win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.CAMERA_KEYFRAME, { id });
    }
  });
};

// Chat in other languages reaches every listener translated, and a failing
// Google says so once a while
const registerTranslation = (handler: AppHandlerVariables) => {
  const {
    connectorService: conn,
    pathManagerService: paths,
    notifier,
  } = handler;
  const translation = handler.translationService;
  conn.setChatStage((chat) =>
    translation.forChat(chat, () => chatCommands(handler)),
  );
  translation.onFailure((error) => {
    // Logged once per notice, so an outage can't flood the log
    if (
      notifier.warn(
        "translation",
        FEEDBACK_CODES.TRANSLATION_FAILED,
        t("main.translation.failed", { reason: t(reasonKey(error)) }),
        { key: "translation", windowMs: REPEAT_NOTICE_MS },
      )
    ) {
      Logger.warn(
        `<Translation> Unable to translate chat - ${formatError(error)}`,
        paths.files.logs.translation,
      );
    }
  });
};

// The profile keeps the fans its LIVEs show, whatever features are on.
// Overlays get them as they connect, and again when they change.
const registerFans = ({
  connectorService: conn,
  fansService: fans,
  serverService: server,
  notifier,
}: AppHandlerVariables) => {
  for (const type of FAN_EVENTS) {
    // A sub's months; the others say theirs on the user, if at all
    conn.on(type, (d) =>
      fans.record(d.user, type, "months" in d ? d.months : undefined),
    );
  }

  const message = (): TokioPayload => ({
    type: "tokio:fans",
    data: { fans: fans.list() },
  });
  // The list is read when the push goes, so it's never an old one.
  const push = throttle(() => server.sendToAll(message()), FANS_PUSH_MS);
  fans.onChange(push);
  server.onConnect((id) => server.sendToClient(id, message()));

  const save = () => {
    fans
      .save()
      .then((saved) => {
        // Saving logged it. The fans are tried again on the next save.
        if (saved) return;
        notifier.warn(
          "overlays",
          FEEDBACK_CODES.FANS_SAVE_FAILED,
          t("main.init.fansSaveFailed"),
          { key: "fans", windowMs: REPEAT_NOTICE_MS },
        );
      })
      .catch((error) => {
        notifier.report({ source: "overlays", error });
      });
  };
  conn.on(TOKIO_EVENTS.DISCONNECTED, save);
  // shortcut: a quit or crash during a LIVE loses up to 30 s of fans, upgrade
  // to a save on quit if streamers notice. The updater's install can't wait
  // for one.
  setInterval(save, FANS_SAVE_MS).unref();
};

// The profile keeps each LIVE and its gifters, whatever features are on.
// Overlays get the top gifters as they connect, and again when they change.
const registerHistory = ({
  connectorService: conn,
  historyService: history,
  serverService: server,
  win,
  notifier,
}: AppHandlerVariables) => {
  conn.on(TOKIO_EVENTS.CONNECTED, () => {
    history.start(conn.username);
    // The platform that started it; the others join through onPlatform
    const status = conn.status();
    for (const platform of PLATFORMS) {
      if (status[platform] === "connected") history.join(platform);
    }
  });
  for (const type of HISTORY_EVENTS) {
    conn.on(type, (d) => history.record(type, d));
  }

  const message = (): TokioPayload => ({
    type: "tokio:gifters",
    data: history.top(),
  });
  // The lists are read when the push goes, so they're never old ones. Home's
  // tabs get each platform's top gifters with the overlays' push.
  const push = throttle(() => {
    server.sendToAll(message());
    if (win.isDestroyed()) return;
    win.webContents.send(APP_EVENTS_RESPONSE.LIVE_GIFTERS, {
      byPlatform: history.topByPlatform(),
      subsByPlatform: history.topSubGifters(),
    });
  }, GIFTERS_PUSH_MS);
  history.onChange(push);
  server.onConnect((id) => server.sendToClient(id, message()));

  const save = () => {
    history
      .save()
      .then((saved) => {
        // Saving logged it. The history is tried again on the next save.
        if (saved) return;
        notifier.warn(
          "system",
          FEEDBACK_CODES.HISTORY_SAVE_FAILED,
          t("main.init.historySaveFailed"),
          { key: "history", windowMs: REPEAT_NOTICE_MS },
        );
      })
      .catch((error) => {
        notifier.report({ source: "system", error });
      });
  };
  conn.on(TOKIO_EVENTS.DISCONNECTED, () => {
    history.end();
    // Coin stats lists the LIVE that just ended
    if (!win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.LIVES, {
        data: history.getHistory(),
      });
    }
    save();
  });
  // shortcut: a quit or crash during a LIVE loses the time and gifts since
  // the last save, up to 30 s, since each save writes the LIVE's file. Upgrade
  // to a save on quit if streamers notice. The updater's install can't wait
  // for one.
  setInterval(save, HISTORY_SAVE_MS).unref();
};

events.push(
  APP_EVENTS.GET_PROFILE,
  async ({ storeManagerService }, e) => {
    // Fresh, so a page reopened right after a save gets what it saved
    const profile = await storeManagerService.getProfileData({ fresh: true });
    if (!profile) throw new Error("The active profile is missing.");

    e.reply(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply(storeManagerService, profile),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
      message: "main.failure.getProfile",
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
    fansService,
    historyService,
    gamesService,
    studioService,
    translationService,
    ratesService,
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
      yamlManagerService.setLogFile(files.logs.overlays);
      urlManagerService.setLogFile(files.logs.system);
      storeManagerService.setLogFile(files.logs.system);
      jsonManagerService.setLogFile(files.logs.system);
      alertsService.setLogFile(files.logs.alerts);
      musicService.setLogFile(files.logs.music);
      licensesService.setLogFile(files.logs.system);
      updaterService.setLogFile(files.logs.system);
      liveService.setLogFile(files.logs.connector);
      timerService.setLogFile(files.logs.system);
      fansService.setLogFile(files.logs.system);
      historyService.setLogFile(files.logs.system);
      gamesService.setLogFile(files.logs.games);
      studioService.setLogFile(files.logs.overlays);
      translationService.setLogFile(files.logs.translation);
      ratesService.setLogFile(files.logs.system);
      notifier.setLogFiles(files.logs);
      musicService.setAdBlockFolder(folders.extraFolder);
      alertsService.setSoundsFolder(folders.soundsFolder);
      alertsService.setMediaFolder(folders.mediaFolder);
      alertsService.setSpeaker(ttsService);
      alertsService.setServer(serverService);
      // Not an overlay: the alerts' images and videos, for their overlay pages
      serverService.mount(`${ALERTS_PATH}/media`, folders.mediaFolder);
      gamesService.setPicturesFolder(folders.minecraftFolder);
      // The games overlay's pictures
      serverService.mount(MINECRAFT_PICTURES_PATH, folders.minecraftFolder);
    },
  );
  // Each run starts every log with what wrote it, and the zone makes its local
  // times readable on any machine.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "longOffset",
  })
    .formatToParts()
    .find((part) => part.type === "timeZoneName")?.value;
  Logger.run(
    `<System> Tokio ${app.getVersion()} (${app.isPackaged ? "installed" : "dev"}) · ${process.platform} ${release()} ${process.arch} · Electron ${process.versions.electron} · ${language()} · ${zone} (${offset})`,
    Object.values(pathManagerService.files.logs),
  );
  await storeManagerService.initialize(
    config.DB.name,
    {
      connector: connectorService,
      tts: ttsService,
      translation: translationService,
    },
    jsonManagerService,
    pathManagerService,
  );
  // Before any notice, so they're all in the user's language
  setLanguage(storeManagerService.getSettings().language);
  Logger.setDebug(storeManagerService.getSettings().logs.debug);
  const backup = storeManagerService.corruptedBackup();
  if (backup) {
    notifier.warn(
      "system",
      FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
      t("main.store.reset", { file: backup }),
    );
  }
  timerService.initialize({ store: storeManagerService });
  fansService.initialize({
    json: jsonManagerService,
    folder: pathManagerService.folders.fansFolder,
  });
  historyService.initialize({
    json: jsonManagerService,
    folder: pathManagerService.folders.historyFolder,
  });
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
  storeManagerService.updateLiveStats(EMPTY_LIVE_STATS);
  if (!wired.has(handler)) {
    wired.add(handler);
    liveService.setRates(ratesService);
    connectorService.setRates(ratesService);
    historyService.setRates(ratesService);
    serverService.initEvents(connectorService, musicService);
    // One router: the phone remote and its API, and MCP
    const control = express.Router();
    control.use(
      createRemoteRoutes({
        remote: () => storeManagerService.getSettings().remote,
        state: () => remoteState(handler),
        invoke: handler.invoke,
        labels: remoteLabels,
      }),
      createMcpRoutes(handler),
    );
    serverService.setControlRoutes(control);
    registerConnectorEvents(handler);
    registerControls(handler);
    registerTimer(handler);
    registerGames(handler);
    registerFans(handler);
    registerHistory(handler);
    // After registerConnectorEvents, see registerStudio
    registerStudio(handler);
    registerCameras(handler);
    registerTranslation(handler);
  }

  const settings = storeManagerService.getSettings();
  liveService.setFeed(settings.activityFeed);
  const profile = await storeManagerService.getProfileData();
  if (profile) {
    timerService.load(
      profile.timer,
      settings.activeProfile.file,
      profile.platforms,
    );
  }
  // Its lists update now, so connecting YouTube doesn't wait for them
  if (profile?.music.provider.block_ads) musicService.prepareAdBlocker();
  // Its own file, so the fans load even when the profile doesn't
  if (!(await fansService.load(settings.activeProfile.file))) {
    notifier.warn(
      "overlays",
      FEEDBACK_CODES.FANS_LOAD_FAILED,
      t("main.fans.loadFailed"),
    );
  }
  if (!(await historyService.load(settings.activeProfile.file))) {
    notifier.warn(
      "system",
      FEEDBACK_CODES.HISTORY_LOAD_FAILED,
      t("main.lives.historyLoadFailed"),
    );
  }

  // Before the server starts, so it serves the overlays right away. The
  // gifts saved last time are used when there are any, so startup doesn't
  // wait for TikTok, and fresh ones replace them once they arrive. A profile
  // without TikTok never asks TikTok for them.
  const tiktok = usesTikTok(profile?.platforms ?? ["tiktok"]);
  const cachedGifts = await overlayService.getGifts();
  if (cachedGifts.length > 0 || !tiktok) {
    await overlayService.load(cachedGifts);
    if (tiktok) void refreshTikTokGifts(handler);
  } else {
    const gifts = await fetchOverlayGifts(connectorService);
    if (gifts.length === 0) {
      notifier.warn(
        "overlays",
        FEEDBACK_CODES.GIFTS_FETCH_FAILED,
        t("main.init.giftsFetchFailed"),
      );
    } else {
      giftsFetched(handler);
    }
    await overlayService.load(gifts);
  }

  // A taken port shouldn't stop the app, the server is turned off instead.
  if (!(await serverService.toggleServer(settings.server.enabled))) {
    notifier.report({
      source: "server",
      error: new AppFailure(
        FEEDBACK_CODES.SERVER_START_FAILED,
        t("main.init.serverStartFailed", { port: String(SERVER_PORT) }),
        { level: "warning" },
      ),
    });
    await storeManagerService.updateServerSettings(false);
  }

  // Unlike the server, the setting stays on: the page shows the status.
  if (!(await gamesService.configure(settings.games))) {
    notifier.report({
      source: "games",
      error: new AppFailure(
        FEEDBACK_CODES.GAME_LISTEN_FAILED,
        t("main.init.minecraftListenFailed", { port: String(MINECRAFT_PORT) }),
        { level: "warning" },
      ),
    });
  }

  return settings;
};

// The version Tokio ran as before this one, when it changed: the window then
// shows what's new since it. A new store only records the version.
function versionChange({ app, storeManagerService }: AppHandlerVariables) {
  const version = app.getVersion();
  const last = storeManagerService.getSettings().lastVersion;
  if (last === version) return undefined;
  // A failed save was logged, and What's new shows again on the next start
  void storeManagerService.updateLastVersion(version);
  return storeManagerService.wasRebuilt() ? undefined : last;
}

// The update Tokio restarted to install last run. When Tokio is still on an
// older version, Windows likely refused the unsigned installer: the update
// button then downloads it, since restarting would fail the same way.
function installCheck({
  app,
  storeManagerService,
  updaterService,
  pathManagerService,
  notifier,
}: AppHandlerVariables) {
  const installing = storeManagerService.getSettings().installingVersion;
  if (!installing) return;
  // A failed save was logged, and the check repeats on the next start
  void storeManagerService.updateInstallingVersion("");
  const version = app.getVersion();
  // That version, or a newer one the streamer installed by hand
  if (compareVersions(version, installing) >= 0) return;
  Logger.warn(
    `<Updater> The update to ${installing} didn't install: Tokio is still on ${version}.`,
    pathManagerService.files.logs.system,
  );
  notifier.warn(
    "system",
    FEEDBACK_CODES.UPDATE_NOT_INSTALLED,
    t("main.init.updateNotInstalled", { version: installing }),
  );
  updaterService.markManual(installing);
}

events.push(
  APP_EVENTS.LOAD_APP,
  async (handler, e) => {
    // A window that died while a shortcut field recorded left them suspended
    globalShortcut.setSuspended(false);
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
    // A reloaded window has already shown them. Undefined rather than false,
    // so replies without them look the same.
    const updatedFrom = first ? versionChange(handler) : undefined;
    // Only a first run gets the tour, not a store that didn't load
    const { storeManagerService } = handler;
    const newStore =
      (first &&
        storeManagerService.wasRebuilt() &&
        !storeManagerService.corruptedBackup()) ||
      undefined;
    // The first-start dialog only over a profile nothing was saved in yet:
    // a store rebuilt over the user's profiles gets only the tour
    const profile = newStore && (await storeManagerService.getProfileData());
    const welcome =
      (profile &&
        profile.platforms.length === 1 &&
        profile.platforms[0] === "tiktok" &&
        profile.connector.username === "" &&
        !Object.values(profile.channels).some(Boolean)) ||
      undefined;

    // On every load, so a reloaded window gets it too
    e.reply(APP_EVENTS_RESPONSE.LANGUAGE, language());
    e.reply(APP_EVENTS_RESPONSE.LOAD_APP, {
      success: true,
      updatedFrom,
      newStore,
      welcome,
    });
    if (!first) {
      // The window reloaded, dropping the TTS it was playing
      handler.ttsService.releaseHeld();
      return;
    }

    handler.trayService.setEnabled(settings.tray.enabled);
    warnTaken(handler.notifier, applyStoredShortcuts(handler));
    await initUpdater(handler);
    installCheck(handler);
    handler.updaterService.setAuto(settings.updates.auto);
    handler.overlayService.onUpdates((updates) =>
      reportOverlayUpdates(handler, updates),
    );
    handler.overlayService.setAutoUpdate(settings.overlayUpdates.auto);
  },
  {
    failure: {
      code: FEEDBACK_CODES.APP_LOAD_FAILED,
      message: "app.startFailed",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.LOAD_APP),
  },
);

export default events;
