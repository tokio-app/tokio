import { MessageKey } from "@/common/i18n";
import { PLATFORMS, Platform, PlatformStatus } from "@/common/types";
import {
  EULER_SIGNUP_URL,
  isPlatform,
  PLATFORM_INPUT,
  PLATFORM_LABELS,
} from "@/common/util";
import { Btn, Input, Tabs } from "@/components";
import { cx, formatDuration } from "@/helper";
import { useMenu } from "@/hooks";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { type Ref, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FiPlay, FiPlus, FiSquare, FiX } from "react-icons/fi";
import styles from "../home.module.css";
import { HomeTab, PLATFORM_ICONS, Views } from "../helper";
import { StatValue } from "./StatValue";

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
  // A tab per platform, then All while LIVE on two or more
  tabs: HomeTab[];
  tab: HomeTab;
  onTab: (tab: HomeTab) => void;
  // The platforms in the LIVE, whose tabs say their viewers now
  live: Platform[];
  views: Views;
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
        variant="icon"
        title={add}
        aria-label={add}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <FiPlus size={18} />
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

// The slate: whether the LIVE is on, a tab per platform with its channel and
// Connect, and Connect all
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
    tabs,
    tab,
    onTab,
    live,
    views,
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
  // Platforms whose Connect was pressed, until main says how they're doing
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

  // Opens a platform's tab with its field focused
  const open = (platform: Platform) => {
    flushSync(() => onTab(platform));
    slate.current
      ?.querySelector<HTMLElement>(`[data-platform="${platform}"]`)
      ?.focus();
  };

  // Connects the ready ones and opens the first that needs something, its
  // tab red until it's given
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
    if (first) open(first);
  };

  const remove = (platform: Platform) => {
    // The focus goes to Add, as the tab with its button leaves
    flushSync(() => onPlatformsChange(platforms.filter((p) => p !== platform)));
    menu.toggleRef.current?.focus();
  };

  const add = (platform: Platform) => {
    flushSync(() =>
      onPlatformsChange(
        PLATFORMS.filter((p) => p === platform || platforms.includes(p)),
      ),
    );
    open(platform);
  };

  const field = (platform: Platform) => {
    const locked = on(platform) || (!several && busy);
    const invalid = missing[platform] !== undefined;
    if (PLATFORM_INPUT[platform] === "account") {
      return twitchLogin ? (
        <span
          className={styles.line_account}
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
        className={styles.line_input}
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

  // How a platform is doing, or what it needs to connect, under its field
  const state = (platform: Platform) => {
    const now =
      status[platform] ??
      (pending.includes(platform) ? "connecting" : undefined);
    const need = missing[platform];
    // Twitch's own sentence turns red instead
    if (need && !now && PLATFORM_INPUT[platform] !== "account") {
      return (
        <span className={styles.line_need} role="alert">
          {t(need)}
        </span>
      );
    }
    if (now) {
      return (
        <span
          className={cx(styles.line_state, now === "connected" && styles.up)}
        >
          {t(STATES[now])}
        </span>
      );
    }
    // Down while the others are live
    return busy ? (
      <span className={styles.line_state}>{t("home.dashboard.down")}</span>
    ) : null;
  };

  // Connect all until anything is on
  const anyOn = busy || platforms.some(on);

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
        <div className={styles.tab_row}>
          <Tabs
            className={styles.platform_tabs}
            label={t("home.dashboard.platforms")}
            tabs={tabs.map((value) => {
              // Each says its viewers now while it's in the LIVE
              const count =
                value === "all"
                  ? views.current
                  : live.includes(value)
                    ? (views.platformViewers[value] ?? 0)
                    : null;
              const shown = count !== null && (
                <StatValue value={count} className={styles.tab_count} />
              );
              if (value === "all") {
                return {
                  value,
                  label: (
                    <>
                      {t("home.stats.all")}
                      {shown}
                    </>
                  ),
                };
              }
              const Icon = PLATFORM_ICONS[value];
              const up = status[value] === "connected";
              return {
                value,
                icon: <Icon className={cx(up && styles.up)} aria-hidden />,
                // Rose while it's up, the picked one's too
                accent: up ? "var(--accent-primary)" : undefined,
                label: (
                  <>
                    {/* Red while it lacks what Connect needs */}
                    <span className={cx(missing[value] && styles.tab_need)}>
                      {PLATFORM_LABELS[value]}
                    </span>
                    {shown}
                  </>
                ),
              };
            })}
            value={tab}
            onChange={onTab}
          />
          <AddPlatform platforms={platforms} onAdd={add} menu={menu} />
          {/* Alone, the platform's own Connect is all there is */}
          {several && (
            // Rose only while connecting is the thing to do
            <Btn
              variant={anyOn ? "default" : "accent"}
              className={styles.connect_btn}
              loading={loading}
              onClick={anyOn ? () => onDisconnect() : () => connect(platforms)}
            >
              {anyOn ? (
                <>
                  <FiSquare size={16} /> {t("home.dashboard.disconnectAll")}
                </>
              ) : (
                <>
                  <FiPlay size={16} /> {t("home.dashboard.connectAll")}
                </>
              )}
            </Btn>
          )}
        </div>

        {tab !== "all" && (
          <div className={styles.line}>
            <div className={styles.line_field}>
              {field(tab)}
              {state(tab)}
            </div>
            {several ? (
              <>
                <Btn
                  className={styles.line_btn}
                  loading={pending.includes(tab) && !status[tab]}
                  aria-label={`${t(on(tab) ? "common.disconnect" : "common.connect")} ${PLATFORM_LABELS[tab]}`}
                  onClick={() => (on(tab) ? onDisconnect(tab) : connect([tab]))}
                >
                  {t(on(tab) ? "common.disconnect" : "common.connect")}
                </Btn>
                <Btn
                  variant="icon"
                  title={t("home.dashboard.removePlatform", {
                    platform: PLATFORM_LABELS[tab],
                  })}
                  aria-label={t("home.dashboard.removePlatform", {
                    platform: PLATFORM_LABELS[tab],
                  })}
                  disabled={on(tab)}
                  onClick={() => remove(tab)}
                >
                  <FiX size={16} />
                </Btn>
              </>
            ) : (
              // The only platform: Home's Connect, rose until it's on
              <Btn
                variant={busy ? "default" : "accent"}
                className={styles.line_btn}
                loading={loading}
                onClick={busy ? () => onDisconnect() : () => connect(platforms)}
              >
                {t(busy ? "common.disconnect" : "common.connect")}
              </Btn>
            )}
          </div>
        )}
      </div>

      {needsKey && tab === "tiktok" && !on("tiktok") && (
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
