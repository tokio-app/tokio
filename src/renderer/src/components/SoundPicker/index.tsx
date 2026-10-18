import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useState } from "react";
import { Tabs } from "../Elements";
import { Modal } from "../Modal";
import { LibraryTab } from "./LibraryTab";
import { MyInstantsTab } from "./MyInstantsTab";
import styles from "./soundpicker.module.css";

type Tab = "library" | "myinstants";

const TABS: { value: Tab; label: string }[] = [
  { value: "library", label: "My sounds" },
  { value: "myinstants", label: "MyInstants" },
];

type Props = {
  // Id of the alert the picked sound is for
  id: string;
  // Id of the sound test loading or playing
  testing: string | null;
  onTest: (req: AlertTestRequest) => void;
  // Picks a sound from the library, which is already saved
  onSelect: (sound: AlertSound) => void;
  onClose: () => void;
};

export function SoundPicker({ id, testing, onTest, onSelect, onClose }: Props) {
  // Chosen once the library loads: the library if it has sounds
  const [tab, setTab] = useState<Tab | null>(null);
  const [library, setLibrary] = useState<AlertSound[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

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

  return (
    <Modal
      title="Select a sound"
      description="Pick one of your sounds, search MyInstants, or use a file from your computer."
      confirmText="Browse file..."
      maxWidth="640px"
      onClose={onClose}
      onConfirm={() => window.api.emit(APP_EVENTS.IMPORT_SOUND, { id })}
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

      {saveFailed && <p className={styles.error}>Couldn't save that sound.</p>}
    </Modal>
  );
}
