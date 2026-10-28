import { AppNotification } from "@/common/types";
import { cx } from "@/helper/cx";
import { useMenu } from "@/hooks/useMenu";
import { useLanguage, useT } from "@/ui/i18n";
import { useEffect } from "react";
import { FiBell } from "react-icons/fi";
import { Btn } from "../Elements";
import { LevelIcon } from "../Toasts";
import styles from "./notificationbell.module.css";

type Props = {
  // Newest first
  history: AppNotification[];
  unread: number;
  unreadError: boolean;
  // Called while the list is open, so what it shows counts as read
  onSeen: () => void;
  onClear: () => void;
};

const formatTime = (timestamp: number, language: string) =>
  new Date(timestamp).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });

/** Title bar button with the notices of this session. */
export function NotificationBell({
  history,
  unread,
  unreadError,
  onSeen,
  onClear,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const { open, ref, toggleRef, toggle, onKeyDown } = useMenu();

  // Also marks the notices that arrive while the list is open.
  useEffect(() => {
    if (open) onSeen();
  }, [open, history, onSeen]);

  return (
    <div className={styles.container} ref={ref} onKeyDown={onKeyDown}>
      <Btn
        ref={toggleRef}
        variant="icon"
        title={t("components.notifications.title")}
        // The badge would name it otherwise
        aria-label={
          unread > 0
            ? t("components.notifications.unread", { count: unread })
            : t("components.notifications.title")
        }
        aria-expanded={open}
        active={open}
        className={styles.toggle}
        onClick={toggle}
      >
        <FiBell size={18} />
        {unread > 0 && (
          <span
            aria-hidden
            className={cx(styles.badge, unreadError && styles.badge_error)}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Btn>

      {open && (
        <div className={styles.menu}>
          <div className={styles.header}>
            <span className={styles.title}>
              {t("components.notifications.title")}
            </span>
            {history.length > 0 && (
              <Btn variant="icon" onClick={onClear}>
                {t("components.notifications.clear")}
              </Btn>
            )}
          </div>

          {history.length === 0 ? (
            <p className={styles.empty}>
              {t("components.notifications.empty")}
            </p>
          ) : (
            <ul className={styles.list}>
              {history.map((n) => (
                <li key={n.id} className={styles.item}>
                  <LevelIcon level={n.level} size={16} />
                  <span className={styles.message}>{n.message}</span>
                  <time className={styles.time}>
                    {formatTime(n.timestamp, language)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
