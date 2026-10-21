import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  VoiceData,
  VoiceEngine,
} from "@/common/types";
import { cx } from "@/helper/cx";
import { voiceDetails } from "@/helper/voices";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";
import elements from "../Elements/elements.module.css";
import styles from "./voiceselect.module.css";
import { VoicePicker } from "./VoicePicker";

type Props = {
  value: VoiceData;
  // Speed and pitch the previews play at
  filters: { speed: number; pitch: number };
  onChange: (voice: VoiceData) => void;
};

/**
 * Shows the voice, and opens a picker to search, filter and preview the
 * voices of every engine. The picker is portaled to the body, so it stacks
 * over a modal it's opened from.
 */
export function VoiceSelect({ value, filters, onChange }: Props) {
  const [voices, setVoices] = useState<VoiceData[]>([]);
  const [engines, setEngines] = useState<VoiceEngine[]>([]);
  const [open, setOpen] = useState(false);

  useIpcRequest(APP_EVENTS.GET_VOICES);

  useIpcListener(APP_EVENTS_RESPONSE.GET_VOICES, (res) => {
    if (!res?.success) return;
    setVoices(res.voices!);
    setEngines(res.engines!);
  });

  return (
    <>
      <button
        type="button"
        className={cx(elements.select_display, styles.field)}
        title={value.name}
        onClick={() => setOpen(true)}
      >
        <span className={styles.field_label}>
          <span className={styles.name}>{value.name}</span>
          <span className={styles.details}>{voiceDetails(value, engines)}</span>
        </span>
        <FiChevronDown size={16} className={styles.chevron} />
      </button>

      {open &&
        createPortal(
          <VoicePicker
            value={value}
            voices={voices}
            engines={engines}
            filters={filters}
            onSelect={(voice) => {
              onChange(voice);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
