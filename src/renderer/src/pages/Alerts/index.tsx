import { Alert, SavedEmote } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, CustomGift } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { Page, SoundPicker } from "@/components";
import {
  useAlertTest,
  useAudio,
  useEditableSettings,
  useIpcListener,
  useIpcRequest,
} from "@/hooks";
import { useEffect, useState } from "react";
import { ttsDefaultsOf } from "./helper";
import { HeaderSection } from "./sections/HeaderSection";
import { ItemsSection } from "./sections/ItemsSection";

export function Alerts() {
  const [gifts, setGifts] = useState<CustomGift[]>([]);
  // Gifts seen in LIVEs that TikTok's list doesn't have
  const [customGifts, setCustomGifts] = useState<CustomGift[]>([]);
  const [emotes, setEmotes] = useState<SavedEmote[]>([]);
  // What a new TTS message starts with: the TTS page's voice
  const [ttsDefaults, setTtsDefaults] = useState(() =>
    ttsDefaultsOf(defaultProfile.tts),
  );
  // Id of the alert whose sound is being picked
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const { settings, update } = useEditableSettings("alerts", (profile) => {
    setEmotes(profile.emotes);
    setTtsDefaults(ttsDefaultsOf(profile.tts));
  });

  const { setItemGain } = useAudio();
  const test = useAlertTest();

  useIpcRequest(APP_EVENTS.GET_GIFTS);
  useIpcRequest(APP_EVENTS.GET_CUSTOM_GIFTS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_GIFTS, (res) => {
    if (res) setGifts(res.data);
  });

  // The reply, then new ones while connected
  useIpcListener(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, (res) => {
    if (res) setCustomGifts(res.data);
  });

  // New emotes arrive while connected.
  useIpcListener(APP_EVENTS_RESPONSE.EMOTES, (res) => {
    if (res) setEmotes(res.data);
  });

  // An alert plays a sound or speaks a message, picking one drops the other.
  const setOutput = (id: string, output: Pick<Alert, "sound" | "tts">) => {
    update((s) => {
      const alert = s.items.find((a) => a.id === id);
      if (alert) Object.assign(alert, output);
    });
    // A download for another alert can finish while this picker is open
    setPickerFor((current) => (current === id ? null : current));
  };

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (!res?.success || !res.sound) return;
    setOutput(res.id, { sound: res.sound, tts: null });
  });

  // Apply volume changes to sounds that are already waiting or playing.
  useEffect(() => {
    settings.items.forEach((alert) => {
      setItemGain(alert.id, alert.volume / 100);
    });
  }, [settings.items, setItemGain]);

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
          customGifts={customGifts}
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
