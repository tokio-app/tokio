import { AlertSound } from "@/common/schemas";
import {
  Btn,
  DeleteSoundModal,
  EmptyState,
  PlayButton,
  PREVIEW_VOLUME,
  SoundLength,
  testProps,
} from "@/components";
import { useAlertTest } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import styles from "../library.module.css";

interface Props {
  // The ones the search shows, newest first
  sounds: AlertSound[];
  // The library has none
  empty: boolean;
  // An upload or a deletion failed
  failed: boolean;
}

export function SoundsTab({ sounds, empty, failed }: Props) {
  const t = useT();
  // Sound waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<AlertSound | null>(null);
  const test = useAlertTest();

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

      {sounds.length === 0 ? (
        <EmptyState>
          {empty
            ? t("alerts.library.soundsEmpty")
            : t("alerts.library.soundsNoMatch")}
        </EmptyState>
      ) : (
        <ul className={styles.panel} aria-label={t("alerts.library.sounds")}>
          {sounds.map((sound) => (
            <li key={sound.file} className={styles.sound}>
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
              <span className={styles.name} title={sound.name}>
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
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <p className={styles.error}>{t("alerts.library.soundsError")}</p>
      )}
    </>
  );
}
