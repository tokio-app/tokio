import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  MusicInfo,
  Platform,
  PlatformStatus,
  TopGifter,
} from "@/common/types";
import {
  defaultProfile,
  countsCoins,
  defaultStoreData,
  isPlatform,
} from "@/common/util";
import { Modal } from "@/components";
import {
  useImmerState,
  useIpcListener,
  useIpcRequest,
  useServerSwitch,
} from "@/hooks";
import { useT } from "@/ui/i18n";
import { useRef, useState } from "react";
import styles from "./home.module.css";
import { feedKinds, liveStats, NO_SESSION } from "./helper";
import { ActivitySection } from "./sections/ActivitySection";
import { DashboardSection } from "./sections/DashboardSection";
import { FeaturesSection } from "./sections/FeaturesSection";
import { FeedModal } from "./sections/FeedModal";
import { LiveSection } from "./sections/LiveSection";
import { PausedSection } from "./sections/PausedSection";

export function Home() {
  const t = useT();
  const [username, setUsername] = useState(defaultProfile.connector.username);
  const usernameField = useRef<HTMLInputElement>(null);
  const [channels, setChannels] = useState(defaultProfile.channels);
  const [profile, setProfile] = useState(defaultProfile);
  const [features, updateFeatures, setFeatures] = useImmerState(
    defaultStoreData.settings.activeFeatures,
  );
  const [server, setServer] = useState({ enabled: false, overlays: 0 });
  // As in Settings: on asks first, and main answers with the settings
  const serverSwitch = useServerSwitch((enabled) =>
    setServer((s) => ({ ...s, enabled })),
  );
  const [feed, setFeed] = useState(defaultStoreData.settings.activityFeed);
  const [editingFeed, setEditingFeed] = useState(false);
  const [musicConnected, setMusicConnected] = useState(false);
  // Until settings load, so the hint doesn't flash
  const [needsKey, setNeedsKey] = useState(false);
  const [platforms, setPlatforms] = useState(defaultProfile.platforms);
  const [twitchLogin, setTwitchLogin] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<
    Partial<Record<Platform, PlatformStatus>>
  >({});
  const [reconnecting, setReconnecting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [likes, setLikes] = useState(0);
  const [views, setViews] = useState({ current: 0, total: 0 });
  const [session, setSession] = useState(NO_SESSION);
  const [gifters, setGifters] = useState<TopGifter[]>([]);
  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [paused, setPaused] = useState(false);

  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.IS_CONNECTED);
  useIpcRequest(APP_EVENTS.IS_MUSIC_CONNECTED);
  useIpcRequest(APP_EVENTS.GET_LIVE_SESSION);
  useIpcRequest(APP_EVENTS.GET_LIVE_GIFTERS);
  useIpcRequest(APP_EVENTS.GET_SONGS);
  // Asked too, since a reload mid-pause would miss the push
  useIpcRequest(APP_EVENTS.GET_CONTROLS);

  useIpcListener(APP_EVENTS_RESPONSE.CONTROLS, (res) => {
    if (res) setPaused(res.paused);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    setProfile(res.profile!);
    setPlatforms(res.profile!.platforms);
    // A profile pushed while the streamer types a username keeps what they typed
    if (document.activeElement !== usernameField.current) {
      setUsername(res.profile!.connector.username);
    }
    // The same for a channel being typed
    const focused = document.activeElement;
    const typing =
      focused instanceof HTMLElement ? focused.dataset.channel : undefined;
    setChannels((now) =>
      isPlatform(typing)
        ? { ...res.profile!.channels, [typing]: now[typing] ?? "" }
        : res.profile!.channels,
    );
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (!res?.success) return;
    const settings = res.data!.settings;
    setFeatures(settings.activeFeatures);
    setFeed(settings.activityFeed);
    setNeedsKey(!settings.activeConnProvider.key);
    setTwitchLogin(settings.accounts.twitch.login);
    setServer({
      enabled: settings.server.enabled,
      overlays: settings.overlays.length,
    });
  });

  useIpcListener(APP_EVENTS_RESPONSE.CONNECTED, (res) => {
    if (!res) return;
    setConnected(res.live);
    setStatus(res.platforms ?? {});
    setReconnecting(res.reconnecting ?? false);
    setWaiting(res.waiting ?? false);
    // A connect still in progress keeps its spinner, a look for the LIVE
    // leaves Disconnect to press
    setLoading(res.success && !res.live && !res.waiting);
    setLikes(res.stats.likes);
    setViews({ current: res.stats.viewers, total: res.stats.views });
  });

  // What main holds, also when it refused the change
  useIpcListener(APP_EVENTS_RESPONSE.SET_PLATFORMS, (res) => {
    if (res) setPlatforms(res.platforms);
  });

  useIpcListener(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, (res) => {
    if (res?.success) setTwitchLogin(res.login);
  });

  useIpcListener(APP_EVENTS_RESPONSE.VIEWS, (res) => {
    if (res?.data) {
      setViews({ current: res.data.viewers, total: res.data.views });
    }
  });

  useIpcListener(APP_EVENTS_RESPONSE.LIKES, (res) => {
    if (res?.likes) setLikes(res.likes);
  });

  // Also when the player window closes
  useIpcListener(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, (res) => {
    setMusicConnected(res?.success ?? false);
  });

  useIpcListener(APP_EVENTS_RESPONSE.LIVE_SESSION, (res) => {
    if (res) setSession(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.LIVE_GIFTERS, (res) => {
    if (res) setGifters(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.SONGS, (res) => {
    if (res) setSongs(res.data);
  });

  const { totals } = session;
  // The queue keeps its songs while the player is gone
  const song = musicConnected ? songs.find((s) => s.playing) : undefined;

  return (
    <>
      {serverSwitch.asking && (
        <Modal
          title={t("settings.server.confirmTitle")}
          description={t("settings.server.confirmDescription")}
          confirmText={t("settings.server.enable")}
          onClose={serverSwitch.cancel}
          onConfirm={serverSwitch.confirm}
        />
      )}

      {editingFeed && (
        <FeedModal
          feed={feed}
          platforms={platforms}
          onClose={() => setEditingFeed(false)}
          onSave={(saved) => {
            // Main answers with the feed's events, without the hidden ones
            window.api.emit(APP_EVENTS.SET_ACTIVITY_FEED, { feed: saved });
            setFeed(saved);
            setEditingFeed(false);
          }}
        />
      )}

      {/* Out of Layout's padding: the board scrolls on its own, the rail
          runs down the window's right edge */}
      <div className={styles.home}>
        <div className={styles.board}>
          <div className={styles.board_inner}>
            {paused && (
              <PausedSection
                onResume={() =>
                  window.api.emit(APP_EVENTS.CONTROL, {
                    action: "pause",
                    paused: false,
                  })
                }
              />
            )}

            <DashboardSection
              username={username}
              usernameRef={usernameField}
              connected={connected}
              reconnecting={reconnecting}
              waiting={waiting}
              loading={loading}
              needsKey={needsKey}
              startedAt={session.startedAt}
              platforms={platforms}
              status={status}
              twitchLogin={twitchLogin}
              onPlatformsChange={(picked) => {
                setPlatforms(picked);
                window.api.emit(APP_EVENTS.SET_PLATFORMS, {
                  platforms: picked,
                });
              }}
              channels={channels}
              onUsernameChange={setUsername}
              onChannelChange={(platform, channel) =>
                setChannels((c) => ({ ...c, [platform]: channel }))
              }
              onConnect={(only) => {
                // A row's Connect shows its own spinner
                if (!only) setLoading(true);
                window.api.emit(APP_EVENTS.CONNECT, {
                  username,
                  channels,
                  ...(only && { platforms: only }),
                });
              }}
              onDisconnect={(platform) => {
                if (platform) {
                  window.api.emit(APP_EVENTS.DISCONNECT, { platform });
                  return;
                }
                setLoading(true);
                window.api.emit(APP_EVENTS.DISCONNECT);
              }}
            />

            {connected && (
              <LiveSection
                viewers={views.current}
                minutes={session.viewers}
                stats={liveStats(platforms, {
                  ...totals,
                  likes,
                  views: views.total,
                })}
                gifters={countsCoins(platforms) ? gifters : null}
              />
            )}

            <FeaturesSection
              features={features}
              profile={profile}
              musicConnected={musicConnected}
              server={server}
              onServerChange={serverSwitch.toggle}
              onChange={(feature, enabled) => {
                window.api.emit(APP_EVENTS.ACTIVE_FEATURES, {
                  [feature]: enabled,
                });
                updateFeatures((f) => {
                  f[feature] = enabled;
                });
              }}
            />
          </div>
        </div>

        <ActivitySection
          connected={connected}
          activity={session.activity}
          feedOff={!feedKinds(platforms).some(({ kind }) => feed[kind])}
          showPlatform={platforms.length > 1}
          onFeedSettings={() => setEditingFeed(true)}
          song={song}
        />
      </div>
    </>
  );
}
