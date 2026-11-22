import { MessageKey } from "@/common/i18n";
import { PLATFORMS, Platform, PlatformStatus } from "@/common/types";
import {
  EULER_SIGNUP_URL,
  isPlatform,
  PLATFORM_INPUT,
  PLATFORM_LABELS,
} from "@/common/util";
import { Btn, Input } from "@/components";
import { cx, formatDuration } from "@/helper";
import { useMenu } from "@/hooks";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { type Ref, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FiPlay, FiPlus, FiSquare, FiX } from "react-icons/fi";
import styles from "../home.module.css";
import { PLATFORM_ICONS } from "../helper";

interface Props {
  username: string;
  usernameRef?: Ref<HTMLInputElement>;
  // The channel typed for each platform that takes one, TikTok's aside
  channels: Partial<Record<Platform, string>>;
  connected: boolean;
  reconnecting: boolean;
  waiting: boolean;
  loading: boolean;
  // No Euler Stream API key is saved, so connecting can't work
  needsKey: boolean;
  // When the LIVE was connected, null until main says
  startedAt: number | null;
  // The profile's, in Home's order
  platforms: Platform[];
  // How each platform that's on is doing, missing when it's down
  status: Partial<Record<Platform, PlatformStatus>>;
  // The Twitch account signed in to, "" for none
  twitchLogin: string;
  onPlatformsChange: (platforms: Platform[]) => void;
  onUsernameChange: (username: string) => void;
  onChannelChange: (platform: Platform, channel: string) => void;
  // These of the profile's platforms, all of them without
  onConnect: (platforms?: Platform[]) => void;
  // One platform, the others staying on, or all of them without
  onDisconnect: (platform?: Platform) => void;
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

// What a platform still needs before it can connect, null when ready
const needs = (
  platform: Platform,
  {
    username,
    channels,
    twitchLogin,
  }: Pick<Props, "username" | "channels" | "twitchLogin">,
): MessageKey | null => {
  const typed = (text = "") => text.replace("@", "").trim() !== "";
  if (platform === "tiktok") {
    return typed(username) ? null : "home.dashboard.needUsername";
  }
  if (PLATFORM_INPUT[platform] === "account") {
    return twitchLogin ? null : "home.dashboard.needSignIn";
  }
  return typed(channels[platform]) ? null : "home.dashboard.needChannel";
};

// The platforms the profile doesn't use yet, in a menu under its button
function AddPlatform({
  platforms,
  onAdd,
  menu,
}: {
  platforms: Platform[];
  onAdd: (platform: Platform) => void;
  menu: ReturnType<typeof useMenu>;
}) {
  const t = useT();
  const addable = PLATFORMS.filter((p) => !platforms.includes(p));
  if (addable.length === 0) return null;
  const add = t("home.dashboard.addPlatform");
  return (
    <div className={styles.add} ref={menu.ref} onKeyDown={menu.onKeyDown}>
      <Btn
        ref={menu.toggleRef}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <FiPlus size={16} /> {add}
      </Btn>
      {menu.open && (
        <div className={styles.menu} role="menu" aria-label={add}>
          {addable.map((platform) => {
            const Icon = PLATFORM_ICONS[platform];
            return (
              <button
                key={platform}
                type="button"
                role="menuitem"
                className={styles.menu_item}
                onClick={() => {
                  menu.toggle();
                  onAdd(platform);
                }}
              >
                <Icon size={16} aria-hidden /> {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The slate: whether the LIVE is on, each platform with its channel, and
// Connect
export function DashboardSection(props: Props) {
  const {
    username,
    usernameRef,
    channels,
    connected,
    reconnecting,
    waiting,
    loading,
    needsKey,
    startedAt,
    platforms,
    status,
    twitchLogin,
    onPlatformsChange,
    onUsernameChange,
    onChannelChange,
    onConnect,
    onDisconnect,
  } = props;
  const t = useT();
  // Main is on it, so Disconnect is what's left to do
  const busy = connected || waiting;
  const away = connected ? reconnecting : waiting;
  const several = platforms.length > 1;
  // What each platform lacked when Connect was pressed, until it's given
  const [missing, setMissing] = useState<Partial<Record<Platform, MessageKey>>>(
    {},
  );
  // Rows whose Connect was pressed, until main says how they're doing
  const [pending, setPending] = useState<Platform[]>([]);
  const menu = useMenu();
  const slate = useRef<HTMLElement>(null);

  useEffect(() => setPending([]), [status]);

  // What was missing goes once it's given
  useEffect(() => {
    setMissing((now) => {
      const still = Object.fromEntries(
        Object.entries(now).filter(
          ([p]) =>
            isPlatform(p) &&
            needs(p, { username, channels, twitchLogin }) !== null,
        ),
      );
      return Object.keys(still).length === Object.keys(now).length
        ? now
        : still;
    });
  }, [username, channels, twitchLogin]);

  const on = (p: Platform) => status[p] !== undefined || pending.includes(p);

  // Connects the ready ones and says what each other one needs, its field
  // focused
  const connect = (asked: Platform[]) => {
    const lacking: Partial<Record<Platform, MessageKey>> = {};
    for (const p of asked) {
      const need = needs(p, { username, channels, twitchLogin });
      if (need) lacking[p] = need;
    }
    setMissing((now) => ({ ...now, ...lacking }));
    const ready = asked.filter((p) => !lacking[p] && !on(p));
    if (ready.length > 0) {
      if (several) setPending((now) => [...now, ...ready]);
      onConnect(ready.length === platforms.length ? undefined : ready);
    }
    const first = asked.find((p) => lacking[p]);
    if (first && ready.length === 0) {
      slate.current
        ?.querySelector<HTMLInputElement>(`[data-platform="${first}"]`)
        ?.focus();
    }
  };

  const remove = (platform: Platform) => {
    // The focus goes to Add, as the row with its button leaves
    flushSync(() => onPlatformsChange(platforms.filter((p) => p !== platform)));
    menu.toggleRef.current?.focus();
  };

  const add = (platform: Platform) => {
    flushSync(() =>
      onPlatformsChange(
        PLATFORMS.filter((p) => p === platform || platforms.includes(p)),
      ),
    );
    slate.current
      ?.querySelector<HTMLElement>(`[data-platform="${platform}"]`)
      ?.focus();
  };

  const field = (platform: Platform) => {
    const locked = on(platform) || (!several && busy);
    const invalid = missing[platform] !== undefined;
    if (PLATFORM_INPUT[platform] === "account") {
      return twitchLogin ? (
        <span
          className={styles.row_account}
          data-platform={platform}
          tabIndex={-1}
        >{`@${twitchLogin}`}</span>
      ) : (
        // Red once Connect was pressed: it's what Twitch needs. The inner
        // span keeps the spaces around the link, which a flex box drops.
        <span className={cx(styles.account_missing, invalid && styles.need)}>
          <span>
            {rich(t("home.dashboard.twitchSignIn"), {
              settings: (text) => (
                <Link to="/settings" data-platform={platform}>
                  {text}
                </Link>
              ),
            })}
          </span>
        </span>
      );
    }
    const tiktok = platform === "tiktok";
    return (
      <Input
        ref={tiktok ? usernameRef : undefined}
        className={styles.row_input}
        data-platform={platform}
        // Home keeps a channel being typed when the profile comes again
        data-channel={tiktok ? undefined : platform}
        aria-label={PLATFORM_LABELS[platform]}
        aria-invalid={invalid || undefined}
        placeholder={t(
          tiktok
            ? "home.dashboard.username"
            : platform === "kick"
              ? "home.dashboard.kickChannel"
              : "home.dashboard.youtubeChannel",
        )}
        value={tiktok ? username : (channels[platform] ?? "")}
        disabled={locked}
        onChange={(e) =>
          tiktok
            ? onUsernameChange(e.target.value)
            : onChannelChange(platform, e.target.value)
        }
      />
    );
  };

  // How a row's platform is doing, or what it needs to connect, under its
  // field
  const state = (platform: Platform) => {
    const now =
      status[platform] ??
      (pending.includes(platform) ? "connecting" : undefined);
    const need = missing[platform];
    // Twitch's own sentence turns red instead
    if (need && !now && PLATFORM_INPUT[platform] !== "account") {
      return (
        <span className={styles.row_need} role="alert">
          {t(need)}
        </span>
      );
    }
    if (now) {
      return (
        <span
          className={cx(styles.row_state, now === "connected" && styles.row_up)}
        >
          {t(STATES[now])}
        </span>
      );
    }
    // Down while the others are live
    return busy ? (
      <span className={styles.row_state}>{t("home.dashboard.down")}</span>
    ) : null;
  };

  // With several, Connect all until anything is on
  const anyOn = busy || platforms.some(on);
  const primary = several ? anyOn : busy;

  return (
    <section className={styles.slate} ref={slate}>
      {/* The slate says what the page is. App, Layout, e2e and drive-app wait
          for this heading, so it's a 1px box, never display: none. */}
      <h2 className={styles.sr_only}>{t("home.dashboard.title")}</h2>

      <p
        className={cx(styles.status, connected && !away && styles.status_live)}
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

      <div data-tour="connect" className={styles.connect_box}>
        <ul className={styles.rows} aria-label={t("home.dashboard.platforms")}>
          {platforms.map((platform) => {
            const Icon = PLATFORM_ICONS[platform];
            const name = PLATFORM_LABELS[platform];
            const up = on(platform);
            return (
              <li
                key={platform}
                className={cx(styles.row, !several && styles.row_alone)}
              >
                <Icon
                  className={cx(
                    styles.row_icon,
                    status[platform] === "connected" && styles.row_up,
                  )}
                  size={18}
                  aria-hidden
                />
                <span className={styles.row_name}>{name}</span>
                <div className={styles.row_field}>
                  {field(platform)}
                  {state(platform)}
                </div>
                {/* Alone, the platform is Connect's, and can't go */}
                {several && (
                  <>
                    <Btn
                      className={styles.row_btn}
                      loading={pending.includes(platform) && !status[platform]}
                      aria-label={`${t(up ? "common.disconnect" : "common.connect")} ${name}`}
                      onClick={() =>
                        up ? onDisconnect(platform) : connect([platform])
                      }
                    >
                      {t(up ? "common.disconnect" : "common.connect")}
                    </Btn>
                    <Btn
                      variant="icon"
                      title={t("home.dashboard.removePlatform", {
                        platform: name,
                      })}
                      aria-label={t("home.dashboard.removePlatform", {
                        platform: name,
                      })}
                      disabled={up}
                      onClick={() => remove(platform)}
                    >
                      <FiX size={16} />
                    </Btn>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <div className={styles.connect_foot}>
          <AddPlatform platforms={platforms} onAdd={add} menu={menu} />
          {/* Rose only while connecting is the thing to do */}
          <Btn
            variant={primary ? "default" : "accent"}
            size="lg"
            className={styles.connect_btn}
            loading={loading}
            onClick={primary ? () => onDisconnect() : () => connect(platforms)}
          >
            {primary ? (
              <>
                <FiSquare size={18} />{" "}
                {t(
                  several
                    ? "home.dashboard.disconnectAll"
                    : "common.disconnect",
                )}
              </>
            ) : (
              <>
                <FiPlay size={18} />{" "}
                {t(several ? "home.dashboard.connectAll" : "common.connect")}
              </>
            )}
          </Btn>
        </div>
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
