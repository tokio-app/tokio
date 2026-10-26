import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile, defaultStoreData } from "@/common/util";
import { Page } from "@/components";
import { cx } from "@/helper";
import { useImmerState, useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import styles from "./home.module.css";
import { NO_SESSION } from "./helper";
import { ActivitySection } from "./sections/ActivitySection";
import { DashboardSection } from "./sections/DashboardSection";
import { FeaturesSection } from "./sections/FeaturesSection";
import { FeedModal } from "./sections/FeedModal";

export function Home() {
  const [username, setUsername] = useState(defaultProfile.connector.username);
  const [profile, setProfile] = useState(defaultProfile);
  const [features, updateFeatures, setFeatures] = useImmerState(
    defaultStoreData.settings.activeFeatures,
  );
  const [server, setServer] = useState({ enabled: false, overlays: 0 });
  const [feed, setFeed] = useState(defaultStoreData.settings.activityFeed);
  const [editingFeed, setEditingFeed] = useState(false);
  const [musicConnected, setMusicConnected] = useState(false);
  // Until settings load, so the hint doesn't flash
  const [needsKey, setNeedsKey] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [likes, setLikes] = useState(0);
  const [views, setViews] = useState({ current: 0, total: 0 });
  const [session, setSession] = useState(NO_SESSION);

  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.IS_CONNECTED);
  useIpcRequest(APP_EVENTS.IS_MUSIC_CONNECTED);
  useIpcRequest(APP_EVENTS.GET_LIVE_SESSION);

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    setProfile(res.profile!);
    setUsername(res.profile!.connector.username);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (!res?.success) return;
    const settings = res.data!.settings;
    setFeatures(settings.activeFeatures);
    setFeed(settings.activityFeed);
    setNeedsKey(!settings.activeConnProvider.key);
    setServer({
      enabled: settings.server.enabled,
      overlays: settings.overlays.length,
    });
  });

  useIpcListener(APP_EVENTS_RESPONSE.CONNECTED, (res) => {
    if (!res) return;
    setConnected(res.live);
    // A connect still in progress keeps its spinner
    setLoading(res.success && !res.live);
    setLikes(res.stats.likes);
    setViews({ current: res.stats.viewers, total: res.stats.views });
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

  const { totals } = session;

  return (
    <>
      {editingFeed && (
        <FeedModal
          feed={feed}
          onClose={() => setEditingFeed(false)}
          onSave={(saved) => {
            // Main answers with the feed's events, without the hidden ones
            window.api.emit(APP_EVENTS.SET_ACTIVITY_FEED, { feed: saved });
            setFeed(saved);
            setEditingFeed(false);
          }}
        />
      )}

      <Page width="wide">
        <div className={cx(styles.dashboard, connected && styles.live)}>
          <div className={styles.column}>
            <DashboardSection
              username={username}
              connected={connected}
              loading={loading}
              needsKey={needsKey}
              startedAt={session.startedAt}
              stats={[
                { label: "Viewers", value: views.current },
                { label: "Likes", value: likes },
                { label: "Total views", value: views.total },
              ]}
              onUsernameChange={setUsername}
              onConnect={() => {
                if (!username.replace("@", "").trim()) return;
                setLoading(true);
                window.api.emit(APP_EVENTS.CONNECT, { username });
              }}
              onDisconnect={() => {
                setLoading(true);
                window.api.emit(APP_EVENTS.DISCONNECT);
              }}
            />

            <FeaturesSection
              features={features}
              profile={profile}
              musicConnected={musicConnected}
              server={server}
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

          <ActivitySection
            connected={connected}
            totals={[
              { label: "New followers", value: totals.followers },
              { label: "Shares", value: totals.shares },
              { label: "Gifts", value: totals.gifts },
              { label: "Coins", value: totals.coins },
            ]}
            activity={session.activity}
            feedOff={!Object.values(feed).some(Boolean)}
            onFeedSettings={() => setEditingFeed(true)}
          />
        </div>
      </Page>
    </>
  );
}
