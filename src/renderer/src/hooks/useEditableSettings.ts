import { Profile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import isEqual from "fast-deep-equal";
import { useEffect, useRef, useState } from "react";
import { useImmerState } from "./useImmerState";
import { useIpcListener } from "./useIpcListener";
import { useIpcRequest } from "./useIpcRequest";

// Groups quick changes, like dragging a slider or typing, into one save.
const SAVE_DELAY = 300;

type Section = "tts" | "music" | "alerts";

// Sends a section's settings to main, which saves them in the profile
const SAVE: { [K in Section]: (settings: Profile[K]) => void } = {
  tts: (settings) =>
    window.api.emit(APP_EVENTS.UPDATE_TTS_SETTINGS, { settings }),
  music: (settings) =>
    window.api.emit(APP_EVENTS.UPDATE_MUSIC_SETTINGS, { settings }),
  alerts: (settings) =>
    window.api.emit(APP_EVENTS.UPDATE_ALERTS_SETTINGS, { settings }),
};

// Main's reply to each save
const SAVE_REPLY = {
  tts: APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS,
  music: APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS,
  alerts: APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS,
} as const satisfies Record<Section, APP_EVENTS_RESPONSE>;

/**
 * A section of the active profile, saved shortly after each change. A change
 * still waiting is sent when the page closes, and dropped when another
 * profile loads.
 */
export function useEditableSettings<K extends Section>(
  section: K,
  // Called with the profile every time it's loaded
  onLoad?: (profile: Profile) => void,
) {
  const [settings, update, setSettings] = useImmerState<Profile[K]>(
    defaultProfile[section],
  );
  // Last settings sent to main
  const [saved, setSaved] = useState<Profile[K]>(defaultProfile[section]);
  // Settings changed but not sent to main yet
  const pending = useRef<Profile[K] | null>(null);

  useIpcRequest(APP_EVENTS.GET_PROFILE);

  // Also answers profile switches.
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    // A change still waiting was made to the profile shown before, sending
    // it on leaving would write it into this one.
    pending.current = null;
    setSettings(res.profile![section]);
    setSaved(res.profile![section]);
    onLoad?.(res.profile!);
  });

  useIpcListener(SAVE_REPLY[section], (res) => {
    // Resync with what is actually saved
    if (res && !res.success) window.api.emit(APP_EVENTS.GET_PROFILE);
  });

  useEffect(() => {
    // Also when a change is undone before it's sent
    if (isEqual(settings, saved)) {
      pending.current = null;
      return undefined;
    }

    pending.current = settings;
    const timer = setTimeout(() => {
      SAVE[section](settings);
      pending.current = null;
      setSaved(settings);
    }, SAVE_DELAY);

    return () => clearTimeout(timer);
  }, [section, settings, saved]);

  // Don't lose a change made right before leaving the page.
  useEffect(
    () => () => {
      if (pending.current) SAVE[section](pending.current);
    },
    [section],
  );

  return { settings, update };
}
