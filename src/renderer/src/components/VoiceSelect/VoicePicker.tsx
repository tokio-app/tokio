import { VoiceData, VoiceEngine } from "@/common/types";
import { cx } from "@/helper/cx";
import {
  engineOptions,
  filterVoices,
  languageOptions,
  voiceEntries,
  VoiceFilter,
  voiceKey,
} from "@/helper/voices";
import { useT } from "@/ui/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Btn, Input, Select } from "../Elements";
import { Modal } from "../Modal";
import { PlayButton, testProps } from "../PlayButton";
import { useVoicePreview } from "./useVoicePreview";
import styles from "./voiceselect.module.css";

type Props = {
  value: VoiceData;
  voices: VoiceData[];
  engines: VoiceEngine[];
  // Speed and pitch the previews play at
  filters: { speed: number; pitch: number };
  onSelect: (voice: VoiceData) => void;
  onClose: () => void;
};

export function VoicePicker({
  value,
  voices,
  engines,
  filters,
  onSelect,
  onClose,
}: Props) {
  const t = useT();
  const [filter, setFilter] = useState<VoiceFilter>({
    search: "",
    engine: "",
    language: "",
  });
  const preview = useVoicePreview(filters);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () => voiceEntries(voices, engines),
    [voices, engines],
  );
  const engineChoices = useMemo(
    () => engineOptions(entries, engines),
    [entries, engines],
  );
  const languageChoices = useMemo(() => languageOptions(entries), [entries]);
  const shown = useMemo(() => filterVoices(entries, filter), [entries, filter]);
  const selected = voiceKey(value);

  // Open on the current voice, once the voices are in.
  useEffect(() => {
    const list = listRef.current;
    const row = selectedRef.current;
    if (!list || !row) return;
    list.scrollTop = row.offsetTop - (list.clientHeight - row.clientHeight) / 2;
  }, [entries]);

  return (
    <Modal
      title={t("components.voicePicker.title")}
      description={t("components.voicePicker.description")}
      maxWidth="640px"
      onClose={onClose}
      footer={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
    >
      <div className={styles.filters}>
        <Input
          autoFocus
          placeholder={t("components.voicePicker.searchPlaceholder")}
          value={filter.search}
          onChange={(e) => setFilter({ ...filter, search: e.target.value })}
        />
        <Select
          className={styles.filter}
          options={engineChoices}
          value={filter.engine}
          onChange={(engine) => setFilter({ ...filter, engine })}
        />
        <Select
          searchable
          className={styles.filter}
          options={languageChoices}
          value={filter.language}
          onChange={(language) => setFilter({ ...filter, language })}
        />
      </div>

      <div ref={listRef} className={styles.list}>
        {shown.map(({ voice, key, details }) => (
          <div
            key={key}
            ref={key === selected ? selectedRef : undefined}
            className={styles.row}
          >
            <button
              type="button"
              className={cx(styles.pick, key === selected && styles.current)}
              title={voice.name}
              onClick={() => onSelect(voice)}
            >
              <span className={styles.name}>{voice.name}</span>
              <span className={styles.details}>{details}</span>
            </button>
            <PlayButton
              {...testProps(preview.previewing, key)}
              onClick={() => preview.toggle(voice)}
            />
          </div>
        ))}

        {shown.length === 0 && (
          <p className={styles.status}>
            {voices.length === 0
              ? t("components.voicePicker.empty")
              : t("components.voicePicker.noMatch")}
          </p>
        )}
      </div>
    </Modal>
  );
}
