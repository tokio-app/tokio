import { FONT_MAX_LENGTH } from "@/common/schemas";
import { cx } from "@/helper/cx";
import { fontFamily } from "@/helper/format";
import { useT } from "@/ui/i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";
import { Btn, Input, Spinner } from "../Elements";
import elements from "../Elements/elements.module.css";
import styles from "../GiftSelect/giftselect.module.css";
import { Modal } from "../Modal";
import fontStyles from "./fontselect.module.css";

// This computer's font families, each once, A to Z. The main window's session
// has no permission handler, so Electron grants local-fonts.
async function listFonts() {
  const fonts = await window.queryLocalFonts();
  return [...new Set(fonts.map((font) => font.family))]
    .filter((family) => family.length <= FONT_MAX_LENGTH)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Shows the font in its own face, and opens a picker of the fonts installed
 * on this computer. "" is the overlay's own font, Archivo unless
 * `defaultLabel` names another.
 */
export function FontSelect({
  value,
  defaultLabel,
  onChange,
}: {
  value: string;
  // What "" reads as
  defaultLabel?: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = (font: string) =>
    font || (defaultLabel ?? t("common.defaultFont"));
  const name = label(value);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className={cx(elements.select_display, styles.field)}
        title={name}
        onClick={() => setOpen(true)}
      >
        <span className={styles.name} style={{ fontFamily: fontFamily(value) }}>
          {name}
        </span>
        <FiChevronDown size={16} className={styles.chevron} />
      </button>

      {open &&
        createPortal(
          <FontPicker
            value={value}
            label={label}
            onPick={(font) => {
              // Picking the font in use saves nothing.
              if (font !== value) onChange(font);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

type PickerProps = {
  value: string;
  label: (font: string) => string;
  onPick: (font: string) => void;
  onClose: () => void;
};

// The gift picker's list of one pick, each font's name set in that font
function FontPicker({ value, label, onPick, onClose }: PickerProps) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  // Undefined while listing, null when that failed
  const [fonts, setFonts] = useState<string[] | null>();

  useEffect(() => {
    listFonts().then(setFonts, () => setFonts(null));
  }, []);

  // The overlay's own font, then this computer's fonts. The one in use comes
  // first, as in the gift picker, when this computer has it.
  const fontsHere = ["", ...(fonts ?? [])];
  const needle = search.trim().toLowerCase();
  const shown = [
    ...fontsHere.filter((font) => font === value),
    ...fontsHere.filter((font) => font !== value),
  ].filter((font) => label(font).toLowerCase().includes(needle));

  return (
    <Modal
      title={t("components.fonts.title")}
      description={t("components.fonts.description")}
      maxWidth="640px"
      onClose={onClose}
      footer={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
    >
      <Input
        autoFocus
        placeholder={t("components.fonts.searchPlaceholder")}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          // The matches start at the top, wherever the list was scrolled to
          listRef.current?.scrollTo({ top: 0 });
        }}
      />

      <div ref={listRef} className={styles.list}>
        {shown.map((font) => (
          <button
            key={font}
            type="button"
            className={cx(
              styles.row,
              fontStyles.row,
              font === value && styles.current,
            )}
            style={{ fontFamily: fontFamily(font) }}
            title={label(font)}
            onClick={() => onPick(font)}
          >
            <span className={cx(styles.name, fontStyles.specimen)}>
              {label(font)}
            </span>
          </button>
        ))}

        {fonts === undefined && (
          <div className={styles.status}>
            <Spinner />
          </div>
        )}
        {fonts === null && (
          <p className={styles.status}>{t("components.fonts.failed")}</p>
        )}
        {fonts && shown.length === 0 && (
          <p className={styles.status}>{t("components.fonts.noMatch")}</p>
        )}
      </div>
    </Modal>
  );
}
