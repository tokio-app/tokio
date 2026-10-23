import { Alert, MEDIA_DURATION, MediaFile, SavedEmote } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, CustomGift } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { MediaPicker, Page, SoundPicker } from "@/components";
import {
  useAlertTest,
  useAudio,
  useEditableSettings,
  useIpcListener,
  useIpcRequest,
} from "@/hooks";
import { useEffect, useRef, useState } from "react";
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
  // Alerts waiting for main to save a sound. A pick made since drops the
  // alert, so a slow download can't replace it.
  const asked = useRef(new Set<string>());
  // Numbers the sound requests, and the newest one applied per alert, so a
  // late reply to an older request can't replace a newer pick
  const counter = useRef(0);
  const applied = useRef(new Map<string, number>());
  // Id of the alert whose image or video is being picked
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  // The same as asked, for browsed media
  const askedMedia = useRef(new Set<string>());

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

  const pick = (id: string, output: Pick<Alert, "sound" | "tts">) => {
    asked.current.delete(id);
    setOutput(id, output);
  };

  // A download still applies after its picker closed.
  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (!res?.success || !res.sound || !asked.current.has(res.id)) return;
    if (res.request <= (applied.current.get(res.id) ?? 0)) return;
    applied.current.set(res.id, res.request);
    setOutput(res.id, { sound: res.sound, tts: null });
  });

  // Another file keeps the alert's duration.
  const setMedia = (id: string, file: MediaFile | null) => {
    update((s) => {
      const alert = s.items.find((a) => a.id === id);
      if (!alert) return;
      alert.media = file && {
        ...file,
        duration: alert.media?.duration ?? MEDIA_DURATION,
        match_video: alert.media?.match_video ?? false,
      };
    });
  };

  const pickMedia = (id: string, file: MediaFile | null) => {
    askedMedia.current.delete(id);
    setMedia(id, file);
  };

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (!res?.success || !res.media || !askedMedia.current.has(res.id)) return;
    setMedia(res.id, res.media);
  });

  // A deleted sound or media file leaves the alerts shown, as main took it
  // off every profile's.
  useIpcListener(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, (res) => {
    if (!res) return;
    update((s) => {
      for (const alert of s.items) {
        if (alert[res.field]?.file === res.file) alert[res.field] = null;
      }
    });
  });

  // Apply volume changes to sounds that are already waiting or playing.
  useEffect(() => {
    settings.items.forEach((alert) => {
      setItemGain(alert.id, alert.volume / 100);
    });
  }, [settings.items, setItemGain]);

  const pickerAlert = settings.items.find((a) => a.id === pickerFor);
  const mediaAlert = settings.items.find((a) => a.id === mediaFor);

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
          onPickMedia={setMediaFor}
        />
      </Page>

      {pickerAlert && (
        <SoundPicker
          alert={pickerAlert}
          ttsDefaults={ttsDefaults}
          testing={test.testing}
          onTest={test.toggle}
          onRequest={() => {
            asked.current.add(pickerAlert.id);
            return ++counter.current;
          }}
          onSelect={(sound) => pick(pickerAlert.id, { sound, tts: null })}
          onSelectTts={(tts) => pick(pickerAlert.id, { sound: null, tts })}
          onClear={() => pick(pickerAlert.id, { sound: null, tts: null })}
          onClose={() => setPickerFor(null)}
        />
      )}

      {mediaAlert && (
        <MediaPicker
          alert={mediaAlert}
          onRequest={() => askedMedia.current.add(mediaAlert.id)}
          onSelect={(file) => pickMedia(mediaAlert.id, file)}
          onDuration={(duration) =>
            update((s) => {
              const media = s.items.find((a) => a.id === mediaAlert.id)?.media;
              if (media) media.duration = duration;
            })
          }
          onMatch={(match) =>
            update((s) => {
              const media = s.items.find((a) => a.id === mediaAlert.id)?.media;
              if (media) media.match_video = match;
            })
          }
          onClose={() => setMediaFor(null)}
        />
      )}
    </>
  );
}
