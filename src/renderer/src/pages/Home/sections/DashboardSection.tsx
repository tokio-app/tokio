import { EULER_SIGNUP_URL } from "@/common/util";
import { Btn, Input, Section } from "@/components";
import { cx, formatDuration } from "@/helper";
import { rich, useLanguage, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FiPlay, FiSquare } from "react-icons/fi";
import styles from "../home.module.css";
import { Stat, statText } from "../helper";

interface Props {
  username: string;
  connected: boolean;
  loading: boolean;
  // No Euler Stream API key is saved, so connecting can't work
  needsKey: boolean;
  // When the LIVE was connected, null until main says
  startedAt: number | null;
  // TikTok's numbers for the LIVE
  stats: Stat[];
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

export function DashboardSection({
  username,
  connected,
  loading,
  needsKey,
  startedAt,
  stats,
  onUsernameChange,
  onConnect,
  onDisconnect,
}: Props) {
  const t = useT();
  const language = useLanguage();
  return (
    <Section
      title={t("home.dashboard.title")}
      description={t("home.dashboard.description")}
      actions={
        <p className={cx(styles.status, connected && styles.status_live)}>
          <span className={cx(styles.dot, connected && styles.dot_live)} />
          <span>
            {connected ? "LIVE" : t("home.dashboard.offline")}
            {connected && startedAt !== null && (
              <>
                {" · "}
                <LiveTimer since={startedAt} />
              </>
            )}
          </span>
        </p>
      }
    >
      <div className={styles.connect}>
        <Input
          className={styles.username}
          placeholder={t("home.dashboard.username")}
          value={username}
          disabled={connected}
          onChange={(e) => onUsernameChange(e.target.value)}
        />

        <Btn
          variant="accent"
          size="lg"
          className={styles.connect_btn}
          loading={loading}
          onClick={connected ? onDisconnect : onConnect}
        >
          {connected ? (
            <>
              <FiSquare size={18} /> {t("home.dashboard.disconnect")}
            </>
          ) : (
            <>
              <FiPlay size={18} /> {t("home.dashboard.connect")}
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

      <div className={styles.stats}>
        {stats.map(({ label, value }) => {
          const { text, title } = statText(value, connected, language);
          return (
            <div key={label} className={styles.stat}>
              <span className={styles.stat_value} title={title}>
                {text}
              </span>
              <span className={styles.stat_label}>{t(label)}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
