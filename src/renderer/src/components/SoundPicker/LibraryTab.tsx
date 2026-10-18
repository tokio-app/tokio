import { AlertSound } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { cx } from "@/helper/cx";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { Btn, Input } from "../Elements";
import {
  PlayButton,
  PREVIEW_VOLUME,
  TestState,
  testProps,
} from "../PlayButton";
import styles from "./soundpicker.module.css";

type Props = {
  library: AlertSound[];
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  onSelect: (sound: AlertSound) => void;
};

export function LibraryTab({ library, testing, onTest, onSelect }: Props) {
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const sounds = library.filter((s) => s.name.toLowerCase().includes(needle));

  const emptyText =
    library.length === 0
      ? "No sounds yet. Download one from MyInstants, upload them in Settings, or browse for a file."
      : "No sounds match.";

  return (
    <>
      <Input
        placeholder="Filter your sounds..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className={styles.list}>
        {sounds.map((sound) => {
          const test = {
            id: sound.file,
            file: sound.file,
            volume: PREVIEW_VOLUME,
          };
          return (
            <div key={sound.file} className={styles.row}>
              <button
                type="button"
                className={cx(styles.name, styles.pick)}
                title={sound.name}
                onClick={() => onSelect(sound)}
              >
                {sound.name}
              </button>
              <PlayButton
                {...testProps(testing, sound.file)}
                onClick={() => onTest(test)}
              />
              <Btn
                variant="icon"
                title="Remove"
                onClick={() => {
                  // Testing the same sound again stops it.
                  if (testing?.id === sound.file) onTest(test);
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

        {sounds.length === 0 && <p className={styles.status}>{emptyText}</p>}
      </div>
    </>
  );
}
