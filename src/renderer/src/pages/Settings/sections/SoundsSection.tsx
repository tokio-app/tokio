import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import {
  Btn,
  DeleteSoundModal,
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
  // Sound waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<AlertSound | null>(null);

  const test = useAlertTest();

  useIpcRequest(APP_EVENTS.GET_SOUNDS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SOUNDS, (res) => {
    if (!res) return;
    setSounds(res.data);
    setError(!res.success);
  });

  return (
    <>
      {removing && (
        <DeleteSoundModal
          item={removing}
          onClose={() => setRemoving(null)}
          onDelete={({ file }) => {
            if (test.testing?.id === file) test.stop();
          }}
        />
      )}

      <Section
        icon={<FiMusic />}
        title="Sound Library"
        description="Sounds for alerts, shared by every profile."
        actions={
          <Btn
            variant="icon"
            title="Upload"
            onClick={() => window.api.emit(APP_EVENTS.UPLOAD_SOUNDS)}
          >
            <FiUpload size={20} />
          </Btn>
        }
      >
        {sounds.length === 0 ? (
          <EmptyState>No sounds yet.</EmptyState>
        ) : (
          <div className={styles.library}>
            {sounds.map((sound) => {
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
                    title="Delete"
                    onClick={() => setRemoving(sound)}
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
    </>
  );
}
