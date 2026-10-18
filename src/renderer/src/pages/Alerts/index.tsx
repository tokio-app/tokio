import { Alert, Profile, SavedEmote } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, CustomGift } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { Page, SoundPicker } from "@/components";
import {
  useAlertTest,
  useAudio,
  useImmerState,
  useIpcListener,
  useIpcRequest,
} from "@/hooks";
import isEqual from "fast-deep-equal";
import { useEffect, useRef, useState } from "react";
import { ttsDefaultsOf } from "./helper";
import { HeaderSection } from "./sections/HeaderSection";
import { ItemsSection } from "./sections/ItemsSection";

// Groups quick changes, like dragging a volume slider, into one save.
const SAVE_DELAY = 300;

export function Alerts() {
  const [settings, update, setSettings] = useImmerState(
    defaultProfile["alerts"],
  );
  // Last settings sent to main
  const [saved, setSaved] = useState(defaultProfile["alerts"]);
  const [gifts, setGifts] = useState<CustomGift[]>([]);
  const [emotes, setEmotes] = useState<SavedEmote[]>([]);
  // What a new TTS message starts with: the TTS page's voice
  const [ttsDefaults, setTtsDefaults] = useState(() =>
    ttsDefaultsOf(defaultProfile.tts),
  );
  // Id of the alert whose sound is being picked
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Settings changed but not sent to main yet
  const pendingSave = useRef<Profile["alerts"] | null>(null);

  const { setItemGain } = useAudio();
  const test = useAlertTest();

  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcRequest(APP_EVENTS.GET_GIFTS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    setSettings(res.profile!.alerts);
    setSaved(res.profile!.alerts);
    setEmotes(res.profile!.emotes);
    setTtsDefaults(ttsDefaultsOf(res.profile!.tts));
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_GIFTS, (res) => {
    if (res) setGifts(res.data);
  });

  // New emotes arrive while connected.
  useIpcListener(APP_EVENTS_RESPONSE.EMOTES, (res) => {
    if (res) setEmotes(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS, (res) => {
    // Resync with what is actually saved
    if (res && !res.success) window.api.emit(APP_EVENTS.GET_PROFILE);
  });

  // An alert plays a sound or speaks a message, picking one drops the other.
  const setOutput = (id: string, output: Pick<Alert, "sound" | "tts">) => {
    update((s) => {
      const alert = s.items.find((a) => a.id === id);
      if (alert) Object.assign(alert, output);
    });
    setPickerFor(null);
  };

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (!res?.success || !res.sound) return;
    setOutput(res.id, { sound: res.sound, tts: null });
  });

  useEffect(() => {
    if (isEqual(settings, saved)) return undefined;

    pendingSave.current = settings;
    const timer = setTimeout(() => {
      window.api.emit(APP_EVENTS.UPDATE_ALERTS_SETTINGS, { settings });
      pendingSave.current = null;
      setSaved(settings);
    }, SAVE_DELAY);

    return () => clearTimeout(timer);
  }, [settings, saved]);

  // Apply volume changes to sounds that are already waiting or playing.
  useEffect(() => {
    settings.items.forEach((alert) => {
      setItemGain(alert.id, alert.volume / 100);
    });
  }, [settings.items, setItemGain]);

  // Don't lose a change made right before leaving the page.
  useEffect(
    () => () => {
      if (pendingSave.current) {
        window.api.emit(APP_EVENTS.UPDATE_ALERTS_SETTINGS, {
          settings: pendingSave.current,
        });
      }
    },
    [],
  );

  const pickerAlert = settings.items.find((a) => a.id === pickerFor);

  return (
    <>
      <Page width="wide">
        <HeaderSection
          simultaneous={settings.simultaneous}
          queueLength={settings.queue_length}
          update={update}
        />

        <ItemsSection
          items={settings.items}
          gifts={gifts}
          emotes={emotes}
          testing={test.testing}
          onTest={test.toggle}
          update={update}
          onPickSound={setPickerFor}
        />
      </Page>

      {pickerAlert && (
        <SoundPicker
          alert={pickerAlert}
          ttsDefaults={ttsDefaults}
          testing={test.testing}
          onTest={test.toggle}
          onSelect={(sound) => setOutput(pickerAlert.id, { sound, tts: null })}
          onSelectTts={(tts) => setOutput(pickerAlert.id, { sound: null, tts })}
          onClose={() => setPickerFor(null)}
        />
      )}
    </>
  );
}
