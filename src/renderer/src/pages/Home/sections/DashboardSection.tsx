import { EULER_SIGNUP_URL } from "@/common/util";
import { Btn, Input } from "@/components";
import { cx, formatDuration } from "@/helper";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { type Ref, useEffect, useState } from "react";
import { FiPlay, FiSquare } from "react-icons/fi";
import styles from "../home.module.css";

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
  onUsernameChange,
  onConnect,
  onDisconnect,
}: Props) {
  const t = useT();
  // Main is on it, so Disconnect is what's left to do
  const busy = connected || waiting;
  const away = connected ? reconnecting : waiting;
  return (
    <section className={styles.slate}>
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

      <div className={styles.connect} data-tour="connect">
        <Input
          ref={usernameRef}
          className={styles.username}
          placeholder={t("home.dashboard.username")}
          value={username}
          disabled={busy}
          onChange={(e) => onUsernameChange(e.target.value)}
        />

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

      {needsKey && !busy && (
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
