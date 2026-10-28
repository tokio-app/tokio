import { MessageKey } from "@/common/i18n";
import { Alert, AlertSound, AlertTts } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useOptions, useT } from "@/ui/i18n";
import { useRef, useState } from "react";
import { DeleteSoundModal } from "../DeleteModals";
import { Btn, Tabs } from "../Elements";
import { Modal } from "../Modal";
import { PREVIEW_VOLUME, type TestState } from "../PlayButton";
import { LibraryTab } from "./LibraryTab";
import { MyInstantsTab } from "./MyInstantsTab";
import styles from "./soundpicker.module.css";
import { TtsTab } from "./TtsTab";

export { SoundLength } from "./SoundLength";

type Tab = "library" | "myinstants" | "tts";

const TABS: { value: Tab; label: MessageKey }[] = [
  { value: "library", label: "components.soundPicker.tabLibrary" },
  { value: "myinstants", label: "components.soundPicker.tabMyInstants" },
  { value: "tts", label: "components.soundPicker.tabTts" },
];

type Props = {
  // The alert the picked sound is for
  alert: Alert;
  // Voice, speed and pitch a new TTS message starts with
  ttsDefaults: Omit<AlertTts, "message">;
  // The sound test loading or playing
  testing: TestState;
  // Seconds each sound tested lasts, by test id
  lengths: Record<string, number>;
  onTest: (req: AlertTestRequest) => void;
  // Asks main to save a sound for the alert, which replies SET_ALERT_SOUND
  // with the request number this returns
  onRequest: () => number;
  // Picks a sound from the library, which is already saved
  onSelect: (sound: AlertSound) => void;
  // Speaks a message instead of a sound
  onSelectTts: (tts: AlertTts) => void;
  // Takes the sound or message off the alert, the sound stays in the library
  onClear: () => void;
  onClose: () => void;
};

export function SoundPicker({
  alert,
  ttsDefaults,
  testing,
  lengths,
  onTest,
  onRequest,
  onSelect,
  onSelectTts,
  onClear,
  onClose,
}: Props) {
  const t = useT();
  const tabs = useOptions(TABS);
  const { id } = alert;
  // Chosen once the library loads: the library if it has sounds. An alert
  // that speaks opens on its message.
  const [tab, setTab] = useState<Tab | null>(alert.tts ? "tts" : null);
  const [library, setLibrary] = useState<AlertSound[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  // The newest request sent, the only one whose failure is shown
  const latest = useRef(0);
  const request = () => (latest.current = onRequest());
  const [tts, setTts] = useState<AlertTts>(
    () => alert.tts ?? { ...ttsDefaults, message: "" },
  );
  // Sound waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<AlertSound | null>(null);

  useIpcRequest(APP_EVENTS.GET_SOUNDS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SOUNDS, (res) => {
    if (!res) return;
    setLibrary(res.data);
    setTab((open) => open ?? (res.data.length > 0 ? "library" : "myinstants"));
  });

  // Downloads and browsed files both report here.
  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (res?.id === id && res.request === latest.current) {
      setSaveFailed(!res.success);
    }
  });

  const speaking = tab === "tts";

  return (
    <>
      <Modal
        title={
          speaking
            ? t("components.soundPicker.ttsTitle")
            : t("components.soundPicker.title")
        }
        description={
          speaking
            ? t("components.soundPicker.ttsDescription")
            : t("components.soundPicker.description")
        }
        maxWidth="640px"
        onClose={onClose}
        footer={
          <>
            <Btn disabled={!alert.sound && !alert.tts} onClick={onClear}>
              {t("common.clear")}
            </Btn>
            <Btn onClick={onClose}>{t("common.cancel")}</Btn>
            {speaking ? (
              <Btn
                variant="accent"
                disabled={tts.message.trim() === ""}
                onClick={() => onSelectTts(tts)}
              >
                {t("components.soundPicker.useTts")}
              </Btn>
            ) : (
              <Btn
                variant="accent"
                onClick={() => {
                  window.api.emit(APP_EVENTS.IMPORT_SOUND, {
                    id,
                    request: request(),
                  });
                }}
              >
                {t("common.browse")}
              </Btn>
            )}
          </>
        }
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        {tab === "library" && (
          <LibraryTab
            library={library}
            current={alert.tts ? undefined : alert.sound?.file}
            testing={testing}
            onTest={onTest}
            onSelect={onSelect}
            onRemove={setRemoving}
          />
        )}

        <MyInstantsTab
          id={id}
          hidden={tab !== "myinstants"}
          library={library}
          testing={testing}
          lengths={lengths}
          onTest={onTest}
          onRequest={request}
          onSelect={onSelect}
          onRemove={setRemoving}
        />

        {speaking && (
          <TtsTab
            alertId={id}
            trigger={alert.trigger}
            value={tts}
            onChange={setTts}
            testing={testing}
            onTest={onTest}
          />
        )}

        {saveFailed && (
          <p className={styles.error}>
            {t("components.soundPicker.saveFailed")}
          </p>
        )}
      </Modal>

      {removing && (
        <DeleteSoundModal
          item={removing}
          onClose={() => setRemoving(null)}
          onDelete={({ file }) => {
            // Testing the same sound again stops it.
            if (testing?.id === file) {
              onTest({ id: file, file, volume: PREVIEW_VOLUME });
            }
          }}
        />
      )}
    </>
  );
}
