import { cx } from "@/helper/cx";
import { formatList } from "@/helper/format";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";
import { Btn, Check } from "../Elements";
import elements from "../Elements/elements.module.css";
import styles from "../GiftSelect/giftselect.module.css";
import { Modal } from "../Modal";

// TikTok doesn't name emotes, the Alerts page numbers them (emoteOptions).
export type EmoteOption = { value: string; label: string; img: string };

// How many pictures the field shows for several emotes
const FIELD_IMAGES = 3;

const emotesLabel = (count: number) =>
  `${count} ${count === 1 ? "emote" : "emotes"}`;

/**
 * Shows the emotes picked, and opens a picker to check them, kept on Done.
 * It looks like GiftMultiSelect, without the search, coins and sorting:
 * emotes have no names or prices.
 */
export function EmoteMultiSelect({
  emotes,
  value,
  placeholder,
  onChange,
}: {
  emotes: EmoteOption[];
  // Ids, maybe of emotes the list doesn't have
  value: string[];
  placeholder: string;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  // In the list's order. Ids it doesn't have are still counted, the trigger
  // still reacts to them.
  const ids = new Set(value);
  const known = emotes.filter((emote) => ids.has(emote.value));
  const only = value.length === 1 ? known[0] : undefined;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className={cx(elements.select_display, styles.field)}
        title={
          known.length > 0
            ? formatList(known.map((emote) => emote.label))
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <span className={styles.field_label}>
          {value.length === 0 ? (
            <span className={styles.placeholder}>{placeholder}</span>
          ) : (
            <>
              {known.length > 0 && (
                <span className={styles.field_images}>
                  {known.slice(0, FIELD_IMAGES).map((emote) => (
                    <img
                      key={emote.value}
                      src={emote.img}
                      alt=""
                      className={styles.field_img}
                    />
                  ))}
                </span>
              )}
              <span className={styles.name}>
                {only ? only.label : emotesLabel(value.length)}
              </span>
            </>
          )}
        </span>
        <FiChevronDown size={16} className={styles.chevron} />
      </button>

      {open &&
        createPortal(
          <EmotePicker
            emotes={emotes}
            selected={value}
            onApply={(picked) => {
              // Done without a change saves nothing.
              const same =
                picked.length === value.length &&
                picked.every((id, i) => id === value[i]);
              if (!same) onChange(picked);
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
  emotes: EmoteOption[];
  // Ids picked when it opened, maybe some the list doesn't have
  selected: string[];
  onApply: (emotes: string[]) => void;
  onClose: () => void;
};

// The gift picker's checked list, with every emote shown
function EmotePicker({ emotes, selected, onApply, onClose }: PickerProps) {
  // What Done applies: the emotes picked first, then the ones checked here
  const [picked, setPicked] = useState(selected);
  // The emotes picked when it opened are listed first. Checking doesn't move
  // them, so rows stay under the pointer.
  const [first] = useState(() => new Set(selected));
  const shown = useMemo(
    () => [
      ...emotes.filter((emote) => first.has(emote.value)),
      ...emotes.filter((emote) => !first.has(emote.value)),
    ],
    [emotes, first],
  );

  const checked = new Set(picked);
  const unchecked = shown
    .filter((emote) => !checked.has(emote.value))
    .map((emote) => emote.value);

  const toggle = (id: string) =>
    setPicked(
      checked.has(id)
        ? picked.filter((value) => value !== id)
        : [...picked, id],
    );

  return (
    <Modal
      title="Select emotes"
      description="Emotes show up here once a viewer uses them in chat while you're connected."
      maxWidth="640px"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="accent" onClick={() => onApply(picked)}>
            Done
          </Btn>
        </>
      }
    >
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {`${emotesLabel(emotes.length)} · ${picked.length} selected`}
        </span>
        <div className={styles.actions}>
          <Btn
            disabled={unchecked.length === 0}
            onClick={() => setPicked([...picked, ...unchecked])}
          >
            Select all
          </Btn>
          <Btn disabled={picked.length === 0} onClick={() => setPicked([])}>
            Clear
          </Btn>
        </div>
      </div>

      <div className={styles.list}>
        {shown.map((emote) => (
          <label
            key={emote.value}
            className={cx(
              styles.row,
              checked.has(emote.value) && styles.current,
            )}
            title={emote.label}
          >
            <Check
              checked={checked.has(emote.value)}
              onChange={() => toggle(emote.value)}
            />
            <img src={emote.img} alt="" loading="lazy" className={styles.img} />
            <span className={styles.name}>{emote.label}</span>
          </label>
        ))}

        {shown.length === 0 && <p className={styles.status}>No emotes yet.</p>}
      </div>
    </Modal>
  );
}
