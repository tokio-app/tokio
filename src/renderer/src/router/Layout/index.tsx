import Logo from "@/assets/logo.png";
import { EntityMetadata } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { NotificationBell, ProfileDropdown, UpdateButton } from "@/components";
import {
  flushSettings,
  useAudio,
  useIpcListener,
  useIpcRequest,
  useNotifications,
  useUpdateStatus,
} from "@/hooks";
import { TitleBar } from "@/ui/TitleBar";
import { Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LuFlaskConical,
  LuGamepad2,
  LuInfo,
  LuListMusic,
  LuPartyPopper,
  LuPictureInPicture2,
  LuRadio,
  LuSettings,
  LuSpeech,
} from "react-icons/lu";
import styles from "./layout.module.css";

// Lucide only, so the rail's strokes match
const NAV_ITEMS = [
  { to: "/", label: "Home", icon: LuRadio },
  { to: "/overlays", label: "Overlays", icon: LuPictureInPicture2 },
  { to: "/tts", label: "TTS", icon: LuSpeech },
  { to: "/alerts", label: "Alerts", icon: LuPartyPopper },
  { to: "/music", label: "Music", icon: LuListMusic },
  { to: "/games", label: "Games", icon: LuGamepad2 },
  // Pinned to the bottom of the sidebar from here on
  { to: "/tools", label: "Tools", icon: LuFlaskConical, bottom: true },
  // Shows the license notices, keep it in the sidebar
  { to: "/about", label: "About", icon: LuInfo },
  { to: "/settings", label: "Settings", icon: LuSettings },
] as const;

export function Layout() {
  const { resumeContext } = useAudio();
  const notifications = useNotifications();
  const updateStatus = useUpdateStatus();

  const [isConnected, setIsConnected] = useState(false);
  const [profiles, setProfiles] = useState<EntityMetadata[]>([]);
  const [activeProfile, setActiveProfile] = useState<EntityMetadata>({
    file: "",
    name: "",
  });
  const [namesHidden, setNamesHidden] = useState(false);

  useIpcRequest(APP_EVENTS.GET_SETTINGS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (!res?.success) return;
    setProfiles(res.data!.profiles);
    setActiveProfile(res.data!.settings.activeProfile);
  });

  useIpcListener(APP_EVENTS_RESPONSE.CONNECTED, (res) => {
    if (res) setIsConnected(res.success);
  });

  useEffect(() => {
    resumeContext();
  }, [resumeContext]);

  // The sidebar's names cover the page's edge, so Escape hides them until the
  // pointer or focus moves to another link (WCAG 1.4.13)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNamesHidden(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles.container}>
      <TitleBar target="main" logo={Logo} live={isConnected}>
        <ProfileDropdown
          disabled={isConnected}
          profiles={profiles}
          active={activeProfile}
          onProfileSelected={(file) => {
            // Changes still waiting go to the profile they were made on.
            flushSettings();
            window.api.emit(APP_EVENTS.SET_PROFILE, { file });
          }}
        />
        <UpdateButton status={updateStatus} connected={isConnected} />
        <NotificationBell
          history={notifications.history}
          unread={notifications.unread}
          unreadError={notifications.unreadError}
          onSeen={notifications.markSeen}
          onClear={notifications.clear}
        />
      </TitleBar>

      <div className={styles.main_area}>
        <nav
          className={styles.sidebar}
          data-names={namesHidden ? "hidden" : undefined}
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`${styles.sidebar_item} ${
                "bottom" in item ? styles.sidebar_item_bottom : ""
              }`}
              activeProps={{ className: styles.sidebar_item_active }}
              onMouseEnter={() => setNamesHidden(false)}
              onFocus={() => setNamesHidden(false)}
            >
              <item.icon size={20} />
              <span className={styles.sidebar_name}>{item.label}</span>
            </Link>
          ))}
        </nav>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
