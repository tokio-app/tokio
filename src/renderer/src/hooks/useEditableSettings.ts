import { Profile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import isEqual from "fast-deep-equal";
import { useCallback, useEffect, useRef, useState } from "react";
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

// Of every mounted page, see flushSettings
const flushes = new Set<() => void>();

/**
 * Sends the changes still waiting right away. Call it before switching
 * profiles: main saves to the active profile, so they'd land in the new one.
 */
export function flushSettings() {
  flushes.forEach((flush) => flush());
}

/**
 * A section of the active profile, saved shortly after each change. A change
 * still waiting is sent when the page closes or flushSettings is called, and
 * dropped when another profile loads.
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
  // Until then the settings are the defaults, which a save would write over
  // the profile
  const loaded = useRef(false);

  const flush = useCallback(() => {
    const waiting = pending.current;
    if (!waiting || !loaded.current) return;
    pending.current = null;
    SAVE[section](waiting);
    setSaved(waiting);
  }, [section]);

  useIpcRequest(APP_EVENTS.GET_PROFILE);

  // Also answers profile switches.
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    // A change still waiting was made to the profile shown before, sending
    // it on leaving would write it into this one.
    pending.current = null;
    loaded.current = true;
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
    const timer = setTimeout(flush, SAVE_DELAY);

    return () => clearTimeout(timer);
  }, [settings, saved, flush]);

  // Sent right away by flushSettings, and when the page closes so a change
  // made right before leaving isn't lost.
  useEffect(() => {
    flushes.add(flush);
    return () => {
      flushes.delete(flush);
      flush();
    };
  }, [flush]);

  return { settings, update };
}
