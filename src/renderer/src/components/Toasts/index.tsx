import { AppNotification, FeedbackLevel } from "@/common/types";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { useEffect, useRef, useState } from "react";
import { IconType } from "react-icons";
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiInfo,
  FiXCircle,
} from "react-icons/fi";
import { VscClose } from "react-icons/vsc";
import { Btn } from "../Elements";
import styles from "./toasts.module.css";

// How long a toast stays. Missed ones stay in the bell
const TOAST_MS: Record<FeedbackLevel, number> = {
  success: 4000,
  info: 4000,
  warning: 7000,
  error: 10000,
};

const ICONS: Record<FeedbackLevel, IconType> = {
  success: FiCheckCircle,
  info: FiInfo,
  warning: FiAlertTriangle,
  error: FiXCircle,
};

// Sets --level-color for the level
const LEVELS: Record<FeedbackLevel, string> = {
  success: styles.success,
  info: styles.info,
  warning: styles.warning,
  error: styles.error,
};

/** The icon of a notice's level, in the level's color. */
export function LevelIcon({
  level,
  size = 18,
}: {
  level: FeedbackLevel;
  size?: number;
}) {
  const Icon = ICONS[level];
  return (
    <span className={cx(styles.icon, LEVELS[level])}>
      <Icon size={size} />
    </span>
  );
}

type ToastProps = {
  notification: AppNotification;
  // The timer ran out
  onExpire: (id: string) => void;
  // The user closed it
  onClose: (id: string) => void;
};

function Toast({ notification, onExpire, onClose }: ToastProps) {
  const { id, level, message } = notification;
  const duration = TOAST_MS[level];
  const [paused, setPaused] = useState(false);
  // Time left, kept while hovering pauses the timer
  const remaining = useRef(duration);
  const t = useT();

  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => onExpire(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [duration, paused, id, onExpire]);

  return (
    <div
      role={level === "error" ? "alert" : "status"}
      className={cx(styles.toast, LEVELS[level])}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <LevelIcon level={level} />
      <p className={styles.message}>{message}</p>
      <Btn
        variant="icon"
        title={t("common.close")}
        className={styles.close}
        onClick={() => onClose(id)}
      >
        <VscClose size={16} />
      </Btn>
    </div>
  );
}

type Props = {
  // Oldest first, the newest is shown at the bottom
  toasts: AppNotification[];
  onExpire: (id: string) => void;
  onClose: (id: string) => void;
};

/** Notices stacked in the bottom right corner, above modals. */
export function Toasts({ toasts, onExpire, onClose }: Props) {
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t("components.notifications.title")}
      className={styles.viewport}
    >
      {toasts.map((n) => (
        <Toast
          key={n.id}
          notification={n}
          onExpire={onExpire}
          onClose={onClose}
        />
      ))}
    </div>
  );
}
