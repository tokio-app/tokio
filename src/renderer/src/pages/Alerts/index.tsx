import { Alert, AlertSound, MEDIA_DURATION, MediaFile } from "@/common/schemas";
import { APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { Btn, MediaPicker, Page, SoundPicker } from "@/components";
import {
  useAlertTest,
  useAudio,
  useEditableSettings,
  useIpcListener,
} from "@/hooks";
import { useT } from "@/ui/i18n";
import { useEffect, useRef, useState } from "react";
import { MdOutlineAddAlert } from "react-icons/md";
import { AlertEditor } from "./AlertEditor";
import styles from "./alerts.module.css";
import { createAlert, soundClip, ttsDefaultsOf } from "./helper";
import { HeaderSection } from "./sections/HeaderSection";
import { ItemsSection } from "./sections/ItemsSection";
import { useTriggerChoices } from "./useTriggerChoices";

export function Alerts() {
  const t = useT();
  const { giftChoices, emoteChoices, setEmotes } = useTriggerChoices();
  // What a new TTS message starts with: the TTS page's voice
  const [ttsDefaults, setTtsDefaults] = useState(() =>
    ttsDefaultsOf(defaultProfile.tts),
  );
  // Id of the alert being edited
  const [editing, setEditing] = useState<string | null>(null);
  // Id of the alert whose sound is being picked
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Alerts waiting for main to save a sound. A pick made since drops the
  // alert, so a slow download can't replace it.
  const asked = useRef(new Set<string>());
  // Numbers the sound and media requests, and the newest one applied per
  // alert, so a late reply to an older request can't replace a newer pick
  const counter = useRef(0);
  const applied = useRef(new Map<string, number>());
  // Id of the alert whose image or video is being picked
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  // The same as asked and applied, for browsed media
  const askedMedia = useRef(new Set<string>());
  const appliedMedia = useRef(new Map<string, number>());
  // The header's add button, and whether it's in view. Out of it, another
  // shows under the alerts.
  const headerAdd = useRef<HTMLButtonElement>(null);
  const [headerAddShown, setHeaderAddShown] = useState(true);
  // Shows only the alerts whose names have it
  const [search, setSearch] = useState("");

  const { settings, update } = useEditableSettings(
    "alerts",
    (profile, switched) => {
      setEmotes(profile.emotes);
      setTtsDefaults(ttsDefaultsOf(profile.tts));
      // A clone has the same alert ids: a reply for the last profile mustn't
      // land in this one
      if (switched) {
        asked.current.clear();
        askedMedia.current.clear();
      }
    },
  );

  const { setItemGain } = useAudio();
  const test = useAlertTest();

  useEffect(() => {
    if (!headerAdd.current) return undefined;
    const observer = new IntersectionObserver(([entry]) =>
      setHeaderAddShown(entry.isIntersecting),
    );
    observer.observe(headerAdd.current);
    return () => observer.disconnect();
  }, []);

  // A search would hide the new alert.
  const addAlert = () => {
    setSearch("");
    update((s) => {
      s.items.push(createAlert(s.items.length));
    });
  };

  // An alert plays a sound or speaks a message, picking one drops the other.
  const setOutput = (
    id: string,
    { sound, tts }: { sound: AlertSound | null; tts: Alert["tts"] },
  ) => {
    update((s) => {
      const alert = s.items.find((a) => a.id === id);
      if (!alert) return;
      alert.sound = sound && soundClip(sound, alert.sound);
      alert.tts = tts;
    });
    // A download for another alert can finish while this picker is open
    setPickerFor((current) => (current === id ? null : current));
  };

  const pick = (
    id: string,
    output: { sound: AlertSound | null; tts: Alert["tts"] },
  ) => {
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

  // Another file keeps the alert's duration and volume, and plays whole.
  const setMedia = (id: string, file: MediaFile | null) => {
    update((s) => {
      const alert = s.items.find((a) => a.id === id);
      if (!alert) return;
      const cut = alert.media?.file === file?.file ? alert.media : null;
      alert.media = file && {
        ...file,
        duration: alert.media?.duration ?? MEDIA_DURATION,
        volume: alert.media?.volume ?? 100,
        start: cut?.start ?? 0,
        end: cut?.end ?? null,
      };
    });
    // A browsed file can arrive while another alert's picker is open
    setMediaFor((current) => (current === id ? null : current));
  };

  const pickMedia = (id: string, file: MediaFile | null) => {
    askedMedia.current.delete(id);
    setMedia(id, file);
  };

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (!res?.success || !res.media || !askedMedia.current.has(res.id)) return;
    if (res.request <= (appliedMedia.current.get(res.id) ?? 0)) return;
    appliedMedia.current.set(res.id, res.request);
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

  const editIndex = settings.items.findIndex((a) => a.id === editing);
  const editAlert = settings.items[editIndex];
  const pickerAlert = settings.items.find((a) => a.id === pickerFor);
  const mediaAlert = settings.items.find((a) => a.id === mediaFor);

  return (
    <>
      <Page width="wide">
        <HeaderSection
          simultaneous={settings.simultaneous}
          queueLength={settings.queue_length}
          addRef={headerAdd}
          search={search}
          onSearch={setSearch}
          onAdd={addAlert}
          update={update}
        />

        <ItemsSection
          items={settings.items}
          search={search}
          gifts={giftChoices}
          emotes={emoteChoices}
          testing={test.testing}
          onTest={test.toggle}
          update={update}
          onEdit={setEditing}
        />

        {!headerAddShown && (
          <Btn className={styles.add} onClick={addAlert}>
            <MdOutlineAddAlert size={20} />
            {t("alerts.header.add")}
          </Btn>
        )}
      </Page>

      {editAlert && (
        <AlertEditor
          alert={editAlert}
          index={editIndex}
          gifts={giftChoices}
          emotes={emoteChoices}
          testing={test.testing}
          onTest={test.toggle}
          onChange={(changed) =>
            update((s) => {
              const index = s.items.findIndex((a) => a.id === changed.id);
              if (index !== -1) s.items[index] = changed;
            })
          }
          onPickSound={() => setPickerFor(editAlert.id)}
          onPickMedia={() => setMediaFor(editAlert.id)}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Over the editor */}
      {pickerAlert && (
        <SoundPicker
          alert={pickerAlert}
          ttsDefaults={ttsDefaults}
          testing={test.testing}
          lengths={test.lengths}
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
          onRequest={() => {
            askedMedia.current.add(mediaAlert.id);
            return ++counter.current;
          }}
          onSelect={(file) => pickMedia(mediaAlert.id, file)}
          onClose={() => setMediaFor(null)}
        />
      )}
    </>
  );
}
