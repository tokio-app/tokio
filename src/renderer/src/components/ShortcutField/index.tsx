import { APP_EVENTS } from "@/common/types";
import {
  acceleratorKeys,
  currentPlatform,
  keyboardLayout,
  LayoutMap,
  Refusal,
  toAccelerator,
} from "@/helper/accelerator";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { Btn } from "../Elements";
import styles from "./shortcutfield.module.css";

type Props = {
  // An Electron accelerator, "" for none
  value: string;
  onChange: (accelerator: string) => void;
};

const platform = currentPlatform();

const suspend = (suspended: boolean) =>
  window.api.emit(APP_EVENTS.SUSPEND_SHORTCUTS, { suspended });

// Shows a global shortcut, and records a new one when clicked
export function ShortcutField({ value, onChange }: Props) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [layout, setLayout] = useState<LayoutMap>();
  // For the unmount, which can't read state
  const recordingRef = useRef(false);

  useEffect(() => {
    let live = true;
    void keyboardLayout().then((map) => live && setLayout(map));
    return () => {
      live = false;
    };
  }, []);

  // Tokio's own shortcuts would stay off if the field left mid-recording
  useEffect(
    () => () => {
      if (recordingRef.current) suspend(false);
    },
    [],
  );

  const record = (on: boolean) => {
    if (recordingRef.current === on) return;
    recordingRef.current = on;
    setRecording(on);
    setRefusal(null);
    suspend(on);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    // Tab still moves on, and the blur ends recording
    if (e.key === "Tab") return;
    e.preventDefault();
    const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (e.key === "Escape") {
      // Not a dialog's or a page's Escape too
      e.stopPropagation();
      record(false);
      return;
    }
    if (bare && (e.key === "Backspace" || e.key === "Delete")) {
      record(false);
      if (value) onChange("");
      return;
    }
    const result = toAccelerator(
      {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        altGraph: e.getModifierState("AltGraph"),
      },
      platform,
      layout,
    );
    if (!result) return;
    if ("refused" in result) {
      setRefusal(result.refused);
      return;
    }
    record(false);
    onChange(result.accelerator);
  };

  const shown = acceleratorKeys(value, platform)
    .map((k) =>
      "label" in k ? t(`components.shortcutField.keys.${k.label}`) : k.text,
    )
    .join(" + ");

  const message = refusal
    ? t(
        refusal === "modifiers" && platform === "mac"
          ? "components.shortcutField.refused.modifiersMac"
          : `components.shortcutField.refused.${refusal}`,
      )
    : recording
      ? t("components.shortcutField.hint")
      : "";

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <Btn
          title={t("components.shortcutField.change")}
          className={cx(styles.field, recording && styles.recording)}
          aria-pressed={recording}
          onClick={() => record(true)}
          onKeyDown={onKeyDown}
          onBlur={() => record(false)}
        >
          {recording ? (
            <span className={styles.placeholder}>
              {t("components.shortcutField.recording")}
            </span>
          ) : value ? (
            <span className={styles.keys}>{shown}</span>
          ) : (
            <span className={styles.placeholder}>
              {t("components.shortcutField.none")}
            </span>
          )}
        </Btn>
        {value && !recording && (
          <Btn
            variant="icon"
            title={t("components.shortcutField.clear")}
            onClick={() => onChange("")}
          >
            <FiX size={18} />
          </Btn>
        )}
      </div>
      <p
        className={cx(styles.message, refusal && styles.refused)}
        aria-live="polite"
      >
        {message}
      </p>
    </div>
  );
}
