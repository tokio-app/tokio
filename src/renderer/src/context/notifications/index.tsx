import { APP_EVENTS_RESPONSE, AppNotification } from "@/common/types";
import { Toasts } from "@/components/Toasts";
import { useIpcListener } from "@/hooks/useIpcListener";
import React, { createContext, useCallback, useMemo, useState } from "react";

// Notices kept for the bell, this session only
const HISTORY_LIMIT = 50;
// Older toasts leave the screen, they stay in the history
const MAX_TOASTS = 4;

// Read once its toast was closed, the bell was opened, or it was a success
type Entry = AppNotification & { read: boolean };

export interface NotificationsContextType {
  // Newest first
  history: AppNotification[];
  // Notices that left the screen without being read
  unread: number;
  unreadError: boolean;
  markSeen: () => void;
  clear: () => void;
}

export const NotificationsContext =
  createContext<NotificationsContextType | null>(null);

/**
 * Keeps the notices main sends and shows them as toasts. Mounted above
 * AppProvider, so notices sent while the app loads aren't lost.
 */
export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [history, setHistory] = useState<Entry[]>([]);
  // Ids on screen, newest last
  const [toasts, setToasts] = useState<string[]>([]);

  useIpcListener(APP_EVENTS_RESPONSE.NOTIFY, (notification) => {
    if (!notification) return;
    // A success answers the user's own action, so it's never missed
    const entry = { ...notification, read: notification.level === "success" };
    setHistory((h) => [entry, ...h].slice(0, HISTORY_LIMIT));
    setToasts((t) => [...t, notification.id].slice(-MAX_TOASTS));
  });

  // The toast timed out, it counts as unread
  const expire = useCallback((id: string) => {
    setToasts((t) => t.filter((toast) => toast !== id));
  }, []);

  // The user closed the toast, so they've read it
  const close = useCallback((id: string) => {
    setToasts((t) => t.filter((toast) => toast !== id));
    setHistory((h) => h.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  // Keeps the same array when nothing changes, the bell calls it on every update
  const markSeen = useCallback(() => {
    setHistory((h) =>
      h.some((n) => !n.read) ? h.map((n) => ({ ...n, read: true })) : h,
    );
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    setToasts([]);
  }, []);

  const value = useMemo(() => {
    const unread = history.filter((n) => !n.read && !toasts.includes(n.id));
    return {
      history,
      unread: unread.length,
      unreadError: unread.some((n) => n.level === "error"),
      markSeen,
      clear,
    };
  }, [history, toasts, markSeen, clear]);

  const visible = useMemo(
    () => history.filter((n) => toasts.includes(n.id)).reverse(),
    [history, toasts],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <Toasts toasts={visible} onExpire={expire} onClose={close} />
    </NotificationsContext.Provider>
  );
}
