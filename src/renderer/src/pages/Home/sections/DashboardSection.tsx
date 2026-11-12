import { EULER_SIGNUP_URL } from "@/common/util";
import { Btn, Input } from "@/components";
import { cx, formatDuration } from "@/helper";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FiPlay, FiSquare } from "react-icons/fi";
import styles from "../home.module.css";

interface Props {
  username: string;
  connected: boolean;
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
  connected,
  loading,
  needsKey,
  startedAt,
  onUsernameChange,
  onConnect,
  onDisconnect,
}: Props) {
  const t = useT();
  return (
    <section className={styles.slate}>
      {/* The slate says what the page is. App, Layout, e2e and drive-app wait
          for this heading, so it's a 1px box, never display: none. */}
      <h2 className={styles.sr_only}>{t("home.dashboard.title")}</h2>

      <p className={cx(styles.status, connected && styles.status_live)}>
        <span className={cx(styles.dot, connected && styles.dot_live)} />
        {connected ? (
          <>
            {/* Like the title bar's tally, said only to screen readers */}
            <span className={styles.sr_only}>LIVE</span>{" "}
            {startedAt !== null && <LiveTimer since={startedAt} />}
          </>
        ) : (
          t("home.dashboard.offline")
        )}
      </p>

      <div className={styles.connect} data-tour="connect">
        <Input
          className={styles.username}
          placeholder={t("home.dashboard.username")}
          value={username}
          disabled={connected}
          onChange={(e) => onUsernameChange(e.target.value)}
        />

        {/* Rose only while connecting is the thing to do */}
        <Btn
          variant={connected ? "default" : "accent"}
          size="lg"
          className={styles.connect_btn}
          loading={loading}
          onClick={connected ? onDisconnect : onConnect}
        >
          {connected ? (
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

      {needsKey && !connected && (
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
