import { MessageKey } from "@/common/i18n";
import { PLATFORMS, Platform, PlatformStatus } from "@/common/types";
import { EULER_SIGNUP_URL, PLATFORM_LABELS } from "@/common/util";
import { Btn, Input } from "@/components";
import { cx, formatDuration } from "@/helper";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { type Ref, useEffect, useState } from "react";
import { FiPlay, FiSquare } from "react-icons/fi";
import styles from "../home.module.css";
import { PLATFORM_ICONS } from "../helper";

interface Props {
  username: string;
  usernameRef?: Ref<HTMLInputElement>;
  connected: boolean;
  // The connection dropped and is coming back, the LIVE goes on
  reconnecting: boolean;
  // The LIVE stopped on its own and main looks for it again
  waiting: boolean;
  loading: boolean;
  // No Euler Stream API key is saved, so connecting can't work
  needsKey: boolean;
  // When the LIVE was connected, null until main says
  startedAt: number | null;
  // The profile's, which Connect joins
  platforms: Platform[];
  // Main holds a connection: connecting, connected or looking for the LIVE
  locked: boolean;
  // How each platform that's on is doing, missing when it's down
  status: Partial<Record<Platform, PlatformStatus>>;
  // The Twitch account signed in to, "" for none
  twitchLogin: string;
  onPlatformsChange: (platforms: Platform[]) => void;
  // Connects the platforms that are down
  onRetry: () => void;
  onUsernameChange: (username: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

// Ticks on its own, so the page doesn't render every second
function LiveTimer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className={styles.timer}>{formatDuration(now - since)}</span>;
}

const STATES: Record<PlatformStatus, MessageKey> = {
  connecting: "home.dashboard.connecting",
  connected: "home.dashboard.connected",
  reconnecting: "home.dashboard.reconnecting",
  waiting: "home.dashboard.waiting",
};

// The platforms' logos, each pressed while the profile uses it. Never none,
// and locked while main holds a connection.
function PlatformPicker({
  platforms,
  disabled,
  onChange,
}: {
  platforms: Platform[];
  disabled: boolean;
  onChange: (platforms: Platform[]) => void;
}) {
  const t = useT();
  return (
    <div
      className={styles.platforms}
      role="group"
      aria-label={t("home.dashboard.platforms")}
    >
      {PLATFORMS.map((platform) => {
        const Icon = PLATFORM_ICONS[platform];
        const on = platforms.includes(platform);
        return (
          <button
            key={platform}
            type="button"
            className={styles.platform}
            aria-pressed={on}
            aria-label={PLATFORM_LABELS[platform]}
            title={PLATFORM_LABELS[platform]}
            disabled={disabled || (on && platforms.length === 1)}
            onClick={() =>
              onChange(
                PLATFORMS.filter((p) =>
                  p === platform ? !on : platforms.includes(p),
                ),
              )
            }
          >
            <Icon size={18} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

// The slate: the handle with Connect, and whether the LIVE is on
export function DashboardSection({
  username,
  usernameRef,
  connected,
  reconnecting,
  waiting,
  loading,
  needsKey,
  startedAt,
  platforms,
  locked,
  status,
  twitchLogin,
  onPlatformsChange,
  onRetry,
  onUsernameChange,
  onConnect,
  onDisconnect,
}: Props) {
  const t = useT();
  // Main is on it, so Disconnect is what's left to do
  const busy = connected || waiting;
  const away = connected ? reconnecting : waiting;
  // With one platform the status line says it all
  const several = platforms.length > 1;

  const field = (platform: Platform) =>
    platform === "tiktok" ? (
      <Input
        ref={usernameRef}
        className={styles.username}
        placeholder={t("home.dashboard.username")}
        value={username}
        disabled={busy}
        onChange={(e) => onUsernameChange(e.target.value)}
      />
    ) : twitchLogin ? (
      <span className={styles.account}>{`@${twitchLogin}`}</span>
    ) : (
      <span className={styles.account_missing}>
        {rich(t("home.dashboard.twitchSignIn"), {
          settings: (text) => <Link to="/settings">{text}</Link>,
        })}
      </span>
    );

  // How the platform is doing while main holds the connection, with Try
  // again for one that's down while the LIVE goes on
  const state = (platform: Platform) => {
    if (!locked) return null;
    const now = status[platform];
    return (
      <span
        className={cx(
          styles.platform_state,
          now === "connected" && styles.platform_up,
        )}
      >
        {t(now ? STATES[now] : "home.dashboard.down")}
        {!now && connected && (
          <Btn onClick={onRetry}>{t("home.dashboard.retry")}</Btn>
        )}
      </span>
    );
  };
  return (
    <section className={styles.slate}>
      {/* The slate says what the page is. App, Layout, e2e and drive-app wait
          for this heading, so it's a 1px box, never display: none. */}
      <h2 className={styles.sr_only}>{t("home.dashboard.title")}</h2>

      <div className={styles.slate_head}>
        <p
          className={cx(
            styles.status,
            connected && !away && styles.status_live,
          )}
        >
          {/* A ring while the connection is away: rose while the LIVE goes on */}
          <span
            className={cx(
              styles.dot,
              connected && styles.dot_live,
              away && styles.dot_away,
            )}
          />
          {connected && !away ? (
            <>
              {/* Like the title bar's tally, said only to screen readers */}
              <span className={styles.sr_only}>LIVE</span>{" "}
              {startedAt !== null && <LiveTimer since={startedAt} />}
            </>
          ) : connected ? (
            t("home.dashboard.reconnecting")
          ) : waiting ? (
            t("home.dashboard.waiting")
          ) : (
            t("home.dashboard.offline")
          )}
        </p>
        <PlatformPicker
          platforms={platforms}
          disabled={locked || loading}
          onChange={onPlatformsChange}
        />
      </div>

      <div className={styles.connect} data-tour="connect">
        {several ? (
          <ul className={styles.rows}>
            {platforms.map((platform) => {
              const Icon = PLATFORM_ICONS[platform];
              return (
                <li key={platform} className={styles.row}>
                  <Icon
                    className={styles.row_icon}
                    size={20}
                    role="img"
                    aria-label={PLATFORM_LABELS[platform]}
                  />
                  {field(platform)}
                  {state(platform)}
                </li>
              );
            })}
          </ul>
        ) : (
          field(platforms[0] ?? "tiktok")
        )}

        {/* Rose only while connecting is the thing to do */}
        <Btn
          variant={busy ? "default" : "accent"}
          size="lg"
          className={styles.connect_btn}
          loading={loading}
          onClick={busy ? onDisconnect : onConnect}
        >
          {busy ? (
            <>
              <FiSquare size={18} /> {t("common.disconnect")}
            </>
          ) : (
            <>
              <FiPlay size={18} /> {t("common.connect")}
            </>
          )}
        </Btn>
      </div>

      {needsKey && !busy && platforms.includes("tiktok") && (
        <p className={styles.key_hint}>
          {rich(t("home.dashboard.keyHint"), {
            link: (text) => (
              <a href={EULER_SIGNUP_URL} target="_blank" rel="noreferrer">
                {text}
              </a>
            ),
            settings: (text) => <Link to="/settings">{text}</Link>,
          })}
        </p>
      )}
    </section>
  );
}
