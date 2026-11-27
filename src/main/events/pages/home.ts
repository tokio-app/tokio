import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  FEEDBACK_CODES,
  Platform,
  PLATFORMS,
  PlatformStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  EMPTY_LIVE_STATS,
  PLATFORM_INPUT,
  PLATFORM_LABELS,
} from "@/common/util";
import { connectionState, createStack } from "@/helper/events";
import { AppFailure, logsPlace, saveFailure } from "@/helper/feedback";
import { refreshTikTokGifts, usesTikTok } from "@/helper/gifts";
import { t } from "@/helper/i18n";
import { ConnectorFailure } from "@/services/connector/common";
import { StoreManagerService } from "@/services/store";
import { ReplyEvent } from "@/types";
import { normalizeUsername } from "@tokioapp/connector";

const events = createStack("connector");

// What a failed or ended connection replies
const NO_STATS = { ...EMPTY_LIVE_STATS, platformViewers: {} };

// A platform the session already has, which a connect leaves as it is
const isUp = (status?: PlatformStatus) =>
  status === "connected" || status === "reconnecting";

// What to tell the user about a connect that failed, by what went wrong.
// With several platforms, the texts that could be any of them name it.
const connectMessage = (
  platform: Platform,
  handle: string,
  error: ConnectorFailure | undefined,
  several = false,
) => {
  const settings = t("nav.settings");
  const name = PLATFORM_LABELS[platform];
  const failed = () =>
    several || platform !== "tiktok"
      ? t("main.home.connect.failedOn", { handle, platform: name })
      : t("main.home.connect.failed", { handle });
  if (platform === "twitch" && error?.kind === "noKey") {
    return t("main.home.connect.twitchNoKey", { settings });
  }
  if (platform === "twitch" && error?.kind === "badKey") {
    return t("main.home.connect.twitchBadKey", { settings });
  }
  // The platform's own limit, not Euler Stream's
  if (platform !== "tiktok" && error?.kind === "rateLimited") {
    return t("main.home.connect.limitedOn", { platform: name });
  }
  switch (error?.kind) {
    case "offline":
      return several
        ? t("main.home.connect.offlineOn", { handle, platform: name })
        : t("main.home.connect.offline", { handle });
    case "notFound":
      return t("main.home.connect.notFound", { handle, platform: name });
    case "network":
      return t("main.home.connect.network", { platform: name });
    case "noChat":
      return t("main.home.connect.noChat", { handle });
  }
  // The rest are Euler Stream's, which only TikTok's connection uses
  if (platform !== "tiktok") return failed();
  switch (error?.kind) {
    case "rateLimited": {
      const wait = error.retryAfterSeconds;
      return wait
        ? t("main.home.connect.rateLimited", { count: wait })
        : t("main.home.connect.rateLimitedMinute");
    }
    case "noKey":
      return t("main.home.connect.noKey", { settings });
    case "badKey":
      return t("main.home.connect.badKey", { settings });
    case "premium":
      return t("main.home.connect.premium");
    case "sign":
      return t("main.home.connect.sign");
    default:
      return failed();
  }
};

// A pasted LIVE link becomes its @username. A name the library refuses goes
// to the connect as typed, so the user gets its "not found".
const toUsername = (input: string) => {
  try {
    return normalizeUsername(input);
  } catch {
    return input.trim().replace(/^@/, "");
  }
};

// Saves the profile's names as CONNECT and SET_CHANNELS both do: TikTok's
// @username as given, the channels as typed. Only those sent: the store
// merges them over the saved ones, so an older read can't write old ones
// back (MCP sends only the channel it was given).
const saveNames = (
  store: StoreManagerService,
  username: string | undefined,
  channels: Partial<Record<Platform, string>> | undefined,
) =>
  store.updateProfileData({
    ...(username !== undefined && { connector: { username } }),
    ...(channels && { channels }),
  });

events.push(
  APP_EVENTS.CONNECT,
  async (services, e, { username, channels, platforms: only }) => {
    const { storeManagerService, connectorService, notifier } = services;
    const profile = await storeManagerService.getProfileData();
    const used: Platform[] = profile?.platforms.length
      ? profile.platforms
      : ["tiktok"];
    // A row's Connect asks for its platform alone
    const platforms = only ? used.filter((p) => only.includes(p)) : used;
    // As main holds it: a connect during a reconnect stays reconnecting
    const replyState = () =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, connectionState(services));
    // None the profile uses: nothing to connect or tell
    if (platforms.length === 0) {
      replyState();
      return;
    }
    // Connected or connecting, a platform stays on its channel
    const on = connectorService.status();
    const channelOf = (platform: Platform, typed: string) =>
      on[platform] ? connectorService.channel(platform) : typed;
    const name = channelOf("tiktok", toUsername(username));
    // Each platform's channel, or the account signed in to for Twitch
    const targets: Partial<Record<Platform, string>> = {};
    for (const platform of platforms) {
      const typed = channels?.[platform] ?? profile?.channels[platform] ?? "";
      targets[platform] =
        platform === "tiktok"
          ? name
          : PLATFORM_INPUT[platform] === "account"
            ? storeManagerService.getTwitchAccount().login
            : channelOf(platform, typed.trim().replace(/^@/, ""));
    }
    const saved = await saveNames(
      storeManagerService,
      platforms.includes("tiktok") ? name : undefined,
      channels,
    );
    // The LIVE matters more than remembering the username: connect anyway.
    if (!saved) {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        t("main.home.usernameSaveFailed", logsPlace()),
      );
    }
    // A LIVE link shows as typed, not as "@https://…"
    const handleOf = (platform: Platform) => {
      const target = targets[platform] ?? "";
      return target.includes("/") ? target : `@${target}`;
    };
    const several = platforms.length > 1;
    // The connected event comes before connect() resolves, answer on the first.
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      replyState();
      // With several platforms, each one's result says it
      if (several) return;
      notifier.success(
        "connector",
        FEEDBACK_CODES.CONNECTED,
        t("main.home.connected", { handle: handleOf(platforms[0]) }),
      );
    };
    // Answers this connect only, so connects don't pile up listeners.
    connectorService.on(TOKIO_EVENTS.CONNECTED, answer);

    try {
      if (!several) {
        const [platform] = platforms;
        const res = await connectorService.connect({
          [platform]: targets[platform],
        });
        // The user's own Disconnect stopped it: nothing to tell
        if (res.error?.kind === "canceled") {
          replyState();
          return;
        }
        if (!res.success) {
          throw new AppFailure(
            FEEDBACK_CODES.CONNECT_FAILED,
            connectMessage(platform, handleOf(platform), res.error),
            { logged: true },
          );
        }
        answer();
        return;
      }
      // Each platform's result is its own notice, and the state goes again.
      // All of them failing throws nothing, which would add a notice.
      await connectorService.connect(targets, (platform, res) => {
        const key = `connect:${platform}`;
        if (res.error?.kind === "canceled") {
          // The user's own Disconnect stopped it: nothing to tell
        } else if (!res.success) {
          notifier.error(
            "connector",
            FEEDBACK_CODES.CONNECT_FAILED,
            connectMessage(platform, handleOf(platform), res.error, true),
            { key },
          );
        } else if (!isUp(on[platform])) {
          notifier.success(
            "connector",
            FEEDBACK_CODES.CONNECTED,
            t("main.home.connectedOn", {
              handle: handleOf(platform),
              platform: PLATFORM_LABELS[platform],
            }),
            { key },
          );
        }
        replyState();
      });
    } finally {
      connectorService.off(TOKIO_EVENTS.CONNECTED, answer);
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.CONNECT_FAILED,
      message: "main.failure.connect",
    },
    // What main holds: a tab's failed connect leaves the others' LIVE on
    onError: (e, error, _data, services) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        ...connectionState(services),
        error,
      }),
  },
);

// The profile's platforms, picked on Home. No notice: the toggles show them.
events.push(
  APP_EVENTS.SET_PLATFORMS,
  async (services, e, { platforms }) => {
    const { storeManagerService, connectorService, timerService } = services;
    // Known ones once each, in Home's order. One that's on stays: it's
    // disconnected first.
    const on = connectorService.status();
    const picked = PLATFORMS.filter(
      (p) => platforms.includes(p) || on[p] !== undefined,
    );
    if (!(await storeManagerService.updateProfileData({ platforms: picked }))) {
      throw saveFailure();
    }
    e.reply(APP_EVENTS_RESPONSE.SET_PLATFORMS, {
      success: true,
      platforms: picked,
    });
    // The countdown's overlay lists only what they send
    timerService.setPlatforms(picked);
    // TikTok's gifts, once TikTok is added
    if (usesTikTok(picked)) void refreshTikTokGifts(services);
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setPlatforms",
    },
    // What main holds, so the toggles go back
    onError: (e, error, _data, { storeManagerService }) =>
      void storeManagerService
        .getProfileData()
        .catch(() => null)
        .then((profile) =>
          e.reply(APP_EVENTS_RESPONSE.SET_PLATFORMS, {
            success: false,
            error,
            platforms: profile?.platforms ?? ["tiktok"],
          }),
        ),
  },
);

// The names as main holds them, failures included
const replyNames = async (
  e: ReplyEvent,
  store: StoreManagerService,
  error?: AppError,
) => {
  const profile = await store.getProfileData().catch(() => null);
  e.reply(APP_EVENTS_RESPONSE.SET_CHANNELS, {
    success: !error,
    ...(error && { error }),
    username: profile?.connector.username ?? "",
    channels: profile?.channels ?? {},
  });
};

// The names typed for the profile's platforms, saved without connecting. No
// notice: it saves like an autosave.
events.push(
  APP_EVENTS.SET_CHANNELS,
  async ({ storeManagerService, connectorService }, e, data) => {
    // A platform that's on keeps the name it's on: MCP can write while live
    const on = connectorService.status();
    const typed = data.channels;
    const channels =
      typed &&
      Object.fromEntries(
        PLATFORMS.flatMap((p) =>
          typed[p] === undefined || on[p] ? [] : [[p, typed[p]]],
        ),
      );
    const username =
      data.username === undefined || on.tiktok
        ? undefined
        : toUsername(data.username);
    if (!(await saveNames(storeManagerService, username, channels))) {
      throw saveFailure();
    }
    await replyNames(e, storeManagerService);
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setChannels",
    },
    onError: (e, error, _data, { storeManagerService }) =>
      void replyNames(e, storeManagerService, error),
  },
);

events.push(
  APP_EVENTS.DISCONNECT,
  async (services, e, data) => {
    const platform = data ? data.platform : undefined;
    await services.connectorService.disconnect(platform);
    // The others go on: what main holds now
    if (platform) {
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, connectionState(services));
      return;
    }
    e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
      success: false,
      live: false,
      stats: NO_STATS,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.DISCONNECT_FAILED,
      message: "main.failure.disconnect",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
        live: false,
        stats: NO_STATS,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.IS_CONNECTED,
  async (services, e) => {
    e.reply(APP_EVENTS_RESPONSE.CONNECTED, connectionState(services));
  },
  {
    notify: false,
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
        live: false,
        stats: NO_STATS,
        error,
      }),
  },
);

// Also pushed from init as the LIVE goes on
events.push(
  APP_EVENTS.GET_LIVE_SESSION,
  ({ liveService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveService.getSession(),
    });
  },
  { notify: false },
);

// Also pushed from init as gifts come, with the overlays' top gifters
events.push(
  APP_EVENTS.GET_LIVE_GIFTERS,
  ({ historyService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.LIVE_GIFTERS, {
      byPlatform: historyService.topByPlatform(),
      subsByPlatform: historyService.topSubGifters(),
      jewelsByPlatform: historyService.topJewelGifters(),
    });
  },
  { notify: false },
);

// Also pushed from init as the request queue changes
events.push(
  APP_EVENTS.GET_SONGS,
  ({ musicService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.SONGS, { data: musicService.songs() });
  },
  { notify: false },
);

events.push(
  APP_EVENTS.SET_ACTIVITY_FEED,
  async ({ storeManagerService, liveService, notifier }, e, { feed }) => {
    const saved = await storeManagerService.updateActivityFeed(feed);
    liveService.setFeed(feed);
    e.reply(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveService.getSession(),
    });
    if (!saved) throw saveFailure();
    notifier.success(
      "system",
      FEEDBACK_CODES.ACTIVITY_FEED_UPDATED,
      t("main.home.activityFeedUpdated"),
    );
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setActivityFeed",
    },
  },
);

events.push(
  APP_EVENTS.ACTIVE_FEATURES,
  // No notice on success, the switches already show the new state.
  async (
    { storeManagerService, ttsService, alertsService, musicService, win },
    _,
    data,
  ) => {
    const saved = await storeManagerService.updateActiveFeatures({
      ...data,
    });
    if (data.tts === false) {
      ttsService.clearTalk();
      win.webContents.send(APP_EVENTS_RESPONSE.TTS_CLEAR, undefined);
    }
    if (data.alerts === false) {
      alertsService.clear();
      win.webContents.send(APP_EVENTS_RESPONSE.ALERT_CLEAR, undefined);
    }
    if (data.music === false) musicService.clearHandler();
    if (!saved) throw saveFailure();
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.FEATURES_UPDATE_FAILED,
      message: "main.failure.activeFeatures",
    },
  },
);

export default events;
