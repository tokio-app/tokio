import { APP_EVENTS, APP_EVENTS_RESPONSE, LiveSummary } from "@/common/types";
import { Page, Section } from "@/components";
import { cx, formatDate, formatDuration, formatStat } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import {
  timeLeft,
  timerStatusText,
  TimerPush,
} from "@/pages/CountdownTimer/helper";
import homeStyles from "@/pages/Home/home.module.css";
import { useLanguage, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { ReactNode, useEffect, useId, useState } from "react";
import styles from "./tools.module.css";

/**
 * The tools, one row each, with what each holds now: the time left, how
 * many studio overlays there are, the newest LIVE's coins, and how many fans
 * and test overlays there are.
 */
export function Tools() {
  const t = useT();
  const language = useLanguage();
  const [timer, setTimer] = useState<TimerPush>();
  const [lives, setLives] = useState<LiveSummary[]>();
  const [fans, setFans] = useState<number>();
  const [testOverlays, setTestOverlays] = useState<number>();
  const [studio, setStudio] = useState<number>();

  useIpcRequest(APP_EVENTS.GET_TIMER);
  useIpcRequest(APP_EVENTS.GET_STUDIO);
  useIpcRequest(APP_EVENTS.GET_LIVES);
  useIpcRequest(APP_EVENTS.GET_FANS);
  useIpcRequest(APP_EVENTS.GET_TEST_OVERLAYS);

  useIpcListener(APP_EVENTS_RESPONSE.STUDIO, (res) => {
    if (res?.data) setStudio(res.data.length);
  });

  useIpcListener(APP_EVENTS_RESPONSE.TIMER, (res) => {
    if (res?.success && res.data) {
      setTimer({ data: res.data, at: performance.now() });
    }
  });

  useIpcListener(APP_EVENTS_RESPONSE.LIVES, (res) => {
    if (res) setLives(res.data.lives);
  });

  useIpcListener(APP_EVENTS_RESPONSE.FANS, (res) => {
    if (res) setFans(res.data.length);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, (res) => {
    if (res?.success) setTestOverlays(res.data!.length);
  });

  // Another profile's LIVEs and fans
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    window.api.emit(APP_EVENTS.GET_LIVES);
    window.api.emit(APP_EVENTS.GET_FANS);
  });

  const newest = lives?.[0];

  return (
    <Page>
      <Section title={t("nav.tools")}>
        <ul className={styles.tools}>
          <CountdownRow timer={timer} />
          <ToolRow
            to="/tools/studio"
            name={t("studio.title")}
            description={t("studio.description")}
            value={studio !== undefined && formatStat(studio, language).full}
            label={studio !== undefined && t("studio.count", { count: studio })}
          />
          <ToolRow
            to="/tools/coin-stats"
            name={t("coinStats.title")}
            description={t("coinStats.description")}
            value={newest && formatStat(newest.coins, language).full}
            label={
              lives &&
              (newest
                ? t("tools.list.coins", {
                    count: newest.coins,
                    date: formatDate(newest.startedAt, language, "short"),
                  })
                : t("tools.list.noLives"))
            }
          />
          <ToolRow
            to="/tools/fans"
            name={t("fans.title")}
            description={t("fans.description")}
            value={fans !== undefined && formatStat(fans, language).full}
            label={fans !== undefined && t("tools.list.fans", { count: fans })}
          />
          <ToolRow
            to="/tools/test-overlays"
            name={t("tools.test.title")}
            description={t("tools.test.description")}
            value={
              testOverlays !== undefined &&
              formatStat(testOverlays, language).full
            }
            label={
              testOverlays !== undefined &&
              t("tools.list.testOverlays", { count: testOverlays })
            }
          />
        </ul>
      </Section>
    </Page>
  );
}

// The time left ticks between main's pushes, only while the timer runs
function CountdownRow({ timer }: { timer?: TimerPush }) {
  const t = useT();
  const language = useLanguage();
  const running = timer?.data.state.status === "running";
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!running) return undefined;
    const tick = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(tick);
  }, [running]);

  const remaining = timer && timeLeft(timer, timer.data.settings.start, now);

  return (
    <ToolRow
      to="/tools/timer"
      name={t("tools.countdown.title")}
      description={t("tools.countdown.description")}
      live={running}
      // Rounded up, as the preview and the overlay show it
      value={
        remaining !== undefined &&
        formatDuration(Math.ceil(remaining / 1000) * 1000)
      }
      label={
        timer && (
          <>
            {running && (
              <span className={cx(homeStyles.dot, homeStyles.dot_live)} />
            )}
            {timerStatusText(timer.data.state, language)}
          </>
        )
      }
    />
  );
}

interface RowProps {
  to:
    | "/tools/timer"
    | "/tools/studio"
    | "/tools/coin-stats"
    | "/tools/fans"
    | "/tools/test-overlays";
  name: string;
  description: string;
  // Nothing on the right until main sends them
  value?: ReactNode;
  label?: ReactNode;
  // The timer running, the list's one rose
  live?: boolean;
}

// One link per row, named by its tool only
function ToolRow({ to, name, description, value, label, live }: RowProps) {
  const id = useId();
  // Each part its own reference, so they're read with spaces between
  const described = [
    `${id}-description`,
    value && `${id}-value`,
    label && `${id}-label`,
  ];
  return (
    <li>
      <Link
        to={to}
        className={cx(styles.tool, live && styles.tool_live)}
        aria-labelledby={`${id}-name`}
        aria-describedby={described.filter(Boolean).join(" ")}
      >
        <span className={styles.text}>
          <span id={`${id}-name`} className={styles.name}>
            {name}
          </span>
          <span id={`${id}-description`} className={styles.description}>
            {description}
          </span>
        </span>
        <span className={styles.reading}>
          {value && (
            <span id={`${id}-value`} className={styles.value}>
              {value}
            </span>
          )}
          {label && (
            <span
              id={`${id}-label`}
              className={cx(styles.label, live && styles.label_live)}
            >
              {label}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
