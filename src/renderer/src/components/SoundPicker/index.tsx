import { Alert, AlertSound, AlertTts } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useState } from "react";
import { Btn, Tabs } from "../Elements";
import { Modal } from "../Modal";
import type { TestState } from "../PlayButton";
import { LibraryTab } from "./LibraryTab";
import { MyInstantsTab } from "./MyInstantsTab";
import styles from "./soundpicker.module.css";
import { TtsTab } from "./TtsTab";

type Tab = "library" | "myinstants" | "tts";

const TABS: { value: Tab; label: string }[] = [
  { value: "library", label: "My sounds" },
  { value: "myinstants", label: "MyInstants" },
  { value: "tts", label: "Text-to-speech" },
];

type Props = {
  // The alert the picked sound is for
  alert: Alert;
  // Voice, speed and pitch a new TTS message starts with
  ttsDefaults: Omit<AlertTts, "message">;
  // The sound test loading or playing
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  // Picks a sound from the library, which is already saved
  onSelect: (sound: AlertSound) => void;
  // Speaks a message instead of a sound
  onSelectTts: (tts: AlertTts) => void;
  onClose: () => void;
};

export function SoundPicker({
  alert,
  ttsDefaults,
  testing,
  onTest,
  onSelect,
  onSelectTts,
  onClose,
}: Props) {
  const { id } = alert;
  // Chosen once the library loads: the library if it has sounds. An alert
  // that speaks opens on its message.
  const [tab, setTab] = useState<Tab | null>(alert.tts ? "tts" : null);
  const [library, setLibrary] = useState<AlertSound[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tts, setTts] = useState<AlertTts>(
    () => alert.tts ?? { ...ttsDefaults, message: "" },
  );

  useIpcRequest(APP_EVENTS.GET_SOUNDS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SOUNDS, (res) => {
    if (!res) return;
    setLibrary(res.data);
    setTab((t) => t ?? (res.data.length > 0 ? "library" : "myinstants"));
  });

  // Downloads and browsed files both report here.
  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (res?.id === id) setSaveFailed(!res.success);
  });

  const speaking = tab === "tts";

  return (
    <Modal
      title={speaking ? "Speak a message" : "Select a sound"}
      description={
        speaking
          ? "The alert says this with text-to-speech instead of playing a sound."
          : "Pick one of your sounds, search MyInstants, or use a file from your computer."
      }
      confirmText="Browse file..."
      maxWidth="640px"
      onClose={onClose}
      onConfirm={() => window.api.emit(APP_EVENTS.IMPORT_SOUND, { id })}
      footer={
        speaking ? (
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn
              variant="accent"
              disabled={tts.message.trim() === ""}
              onClick={() => onSelectTts(tts)}
            >
              Use text-to-speech
            </Btn>
          </>
        ) : undefined
      }
    >
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "library" && (
        <LibraryTab
          library={library}
          testing={testing}
          onTest={onTest}
          onSelect={onSelect}
        />
      )}

      <MyInstantsTab
        id={id}
        hidden={tab !== "myinstants"}
        library={library}
        testing={testing}
        onTest={onTest}
        onSelect={onSelect}
      />

      {speaking && (
        <TtsTab
          alertId={id}
          trigger={alert.trigger.type}
          value={tts}
          onChange={setTts}
          testing={testing}
          onTest={onTest}
        />
      )}

      {saveFailed && <p className={styles.error}>Couldn't save that sound.</p>}
    </Modal>
  );
}
