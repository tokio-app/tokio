import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { ReactNode, useEffect, useState } from "react";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from "react-icons/vsc";
import { useT } from "../i18n";
import styles from "./titlebar.module.css";

const WINDOW_EVENTS = {
  main: {
    minimize: APP_EVENTS.MINIMIZE_WINDOW,
    maximize: APP_EVENTS.MAXIMIZE_WINDOW,
    close: APP_EVENTS.CLOSE_WINDOW,
    resize: APP_EVENTS_RESPONSE.RESIZE_WINDOW,
  },
  music: {
    minimize: APP_EVENTS.MINIMIZE_MUSIC_WINDOW,
    maximize: APP_EVENTS.MAXIMIZE_MUSIC_WINDOW,
    close: APP_EVENTS.CLOSE_MUSIC_WINDOW,
    resize: APP_EVENTS_RESPONSE.RESIZE_MUSIC_WINDOW,
  },
} as const;

type Props = {
  // Which window the controls act on
  target: keyof typeof WINDOW_EVENTS;
  logo: string;
  // 40px tall instead of 44px, for the music window's nav view
  compact?: boolean;
  // Connected to a LIVE: a rose line lights up at the top, like a camera's
  // tally light
  live?: boolean;
  // Rendered before the window controls
  children?: ReactNode;
};

/**
 * Draggable window header with the logo and the minimize, maximize and close
 * controls.
 */
export function TitleBar({ target, logo, compact, live, children }: Props) {
  const t = useT();
  const events = WINDOW_EVENTS[target];
  const [maximized, setMaximized] = useState(false);

  useEffect(
    () =>
      window.api.on(events.resize, (res) => {
        if (res) setMaximized(res.state !== "normal");
      }),
    [events],
  );

  return (
    <header
      className={`${styles.bar} ${compact ? styles.compact : ""} ${
        live ? styles.live : ""
      }`}
    >
      <div className={styles.brand}>
        <img className={styles.logo} src={logo} alt="Tokio" />
        {/* The line says it on screen, this says it to screen readers */}
        {live && <span className={styles.live_label}>LIVE</span>}
      </div>
      <div className={styles.items}>
        {children}
        <div className={styles.controls}>
          <button
            className={styles.control}
            title={t("titlebar.minimize")}
            onClick={() => window.api.emit(events.minimize)}
          >
            <VscChromeMinimize size={14} />
          </button>
          <button
            className={styles.control}
            title={t(maximized ? "titlebar.restore" : "titlebar.maximize")}
            onClick={() => window.api.emit(events.maximize)}
          >
            {maximized ? (
              <VscChromeRestore size={18} />
            ) : (
              <VscChromeMaximize size={14} />
            )}
          </button>
          <button
            className={`${styles.control} ${styles.close}`}
            title={t("common.close")}
            onClick={() => window.api.emit(events.close)}
          >
            <VscChromeClose size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
