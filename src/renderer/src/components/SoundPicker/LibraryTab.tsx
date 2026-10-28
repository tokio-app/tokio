import { AlertSound } from "@/common/schemas";
import { cx } from "@/helper/cx";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { Btn, Input } from "../Elements";
import {
  PlayButton,
  PREVIEW_VOLUME,
  TestState,
  testProps,
} from "../PlayButton";
import { SoundLength } from "./SoundLength";
import styles from "./soundpicker.module.css";

type Props = {
  library: AlertSound[];
  // The alert's sound
  current?: string;
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  onSelect: (sound: AlertSound) => void;
  // Asks before deleting it
  onRemove: (sound: AlertSound) => void;
};

export function LibraryTab({
  library,
  current,
  testing,
  onTest,
  onSelect,
  onRemove,
}: Props) {
  const t = useT();
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const sounds = library.filter((s) => s.name.toLowerCase().includes(needle));

  const emptyText =
    library.length === 0
      ? t("components.soundPicker.libraryEmpty")
      : t("components.soundPicker.libraryNoMatch");

  return (
    <>
      <Input
        placeholder={t("components.soundPicker.filterPlaceholder")}
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
                className={cx(
                  styles.name,
                  styles.pick,
                  sound.file === current && styles.current,
                )}
                aria-current={sound.file === current || undefined}
                title={sound.name}
                onClick={() => onSelect(sound)}
              >
                {sound.name}
              </button>
              <SoundLength file={sound.file} />
              <PlayButton
                {...testProps(testing, sound.file)}
                onClick={() => onTest(test)}
              />
              <Btn
                variant="icon"
                title={t("common.delete")}
                onClick={() => onRemove(sound)}
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
