import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import {
  Btn,
  EmptyState,
  PlayButton,
  PREVIEW_VOLUME,
  Section,
  testProps,
} from "@/components";
import { useAlertTest, useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { FiMusic, FiTrash2, FiUpload } from "react-icons/fi";
import styles from "../settings.module.css";

export function SoundsSection() {
  const [sounds, setSounds] = useState<AlertSound[]>([]);
  const [error, setError] = useState(false);

  const test = useAlertTest();

  useIpcRequest(APP_EVENTS.GET_SOUNDS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SOUNDS, (res) => {
    if (!res) return;
    setSounds(res.data);
    setError(!res.success);
  });

  return (
    <Section
      icon={<FiMusic />}
      title="Sound Library"
      description="Sounds you upload or download from MyInstants, for alerts on any profile."
      actions={
        <Btn onClick={() => window.api.emit(APP_EVENTS.UPLOAD_SOUNDS)}>
          <FiUpload /> Upload
        </Btn>
      }
    >
      {sounds.length === 0 ? (
        <EmptyState>No sounds yet.</EmptyState>
      ) : (
        <div className={styles.library}>
          {sounds.map((sound) => {
            const playing = test.testing?.id === sound.file;
            return (
              <div key={sound.file} className={styles.library_item}>
                <PlayButton
                  {...testProps(test.testing, sound.file)}
                  onClick={() =>
                    test.toggle({
                      id: sound.file,
                      file: sound.file,
                      volume: PREVIEW_VOLUME,
                    })
                  }
                />
                <span className={styles.library_name} title={sound.name}>
                  {sound.name}
                </span>
                <Btn
                  variant="icon"
                  title="Remove"
                  onClick={() => {
                    if (playing) test.stop();
                    window.api.emit(APP_EVENTS.REMOVE_SOUND, {
                      file: sound.file,
                    });
                  }}
                >
                  <FiTrash2 size={20} />
                </Btn>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className={styles.error}>
          Some sounds couldn't be uploaded or removed.
        </p>
      )}
    </Section>
  );
}
