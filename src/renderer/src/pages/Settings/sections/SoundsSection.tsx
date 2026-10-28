import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import {
  Btn,
  DeleteSoundModal,
  EmptyState,
  PlayButton,
  PREVIEW_VOLUME,
  Section,
  SoundLength,
  testProps,
} from "@/components";
import { useAlertTest, useIpcListener, useIpcRequest } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiMusic, FiTrash2, FiUpload } from "react-icons/fi";
import styles from "../settings.module.css";

export function SoundsSection() {
  const t = useT();
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
        title={t("settings.sounds.title")}
        description={t("settings.sounds.description")}
        actions={
          <Btn
            variant="icon"
            title={t("common.upload")}
            onClick={() => window.api.emit(APP_EVENTS.UPLOAD_SOUNDS)}
          >
            <FiUpload size={20} />
          </Btn>
        }
      >
        {sounds.length === 0 ? (
          <EmptyState>{t("settings.sounds.empty")}</EmptyState>
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
                  <SoundLength file={sound.file} />
                  <Btn
                    variant="icon"
                    title={t("common.delete")}
                    onClick={() => setRemoving(sound)}
                  >
                    <FiTrash2 size={20} />
                  </Btn>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className={styles.error}>{t("settings.sounds.error")}</p>}
      </Section>
    </>
  );
}
