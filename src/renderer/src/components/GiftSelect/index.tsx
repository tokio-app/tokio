import { CustomGift } from "@/common/types";
import { formatList } from "@/helper/format";
import { coinsLabel, giftsLabel } from "@/helper/gifts";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";
import { GiftPicker } from "./GiftPicker";
import styles from "./giftselect.module.css";

type CommonProps = {
  gifts: CustomGift[];
  placeholder?: string;
};

/**
 * Shows the gift, and opens a picker to search the gifts, filter them by
 * coins and sort them. The picker is portaled to the body, so it stacks over
 * a modal it's opened from.
 */
export function GiftSelect({
  value,
  onChange,
  placeholder = "Select a gift...",
  ...common
}: CommonProps & {
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <GiftField
      {...common}
      placeholder={placeholder}
      selected={value === undefined ? [] : [value]}
      onApply={(gifts) => onChange(gifts[0])}
    />
  );
}

/** A GiftSelect for several gifts, checked in the picker and kept on Done. */
export function GiftMultiSelect({
  value,
  onChange,
  placeholder = "Select gifts...",
  ...common
}: CommonProps & {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  return (
    <GiftField
      {...common}
      multiple
      placeholder={placeholder}
      selected={value}
      onApply={(gifts) => {
        // Done without a change saves nothing.
        const same =
          gifts.length === value.length &&
          gifts.every((gift, i) => gift === value[i]);
        if (!same) onChange(gifts);
      }}
    />
  );
}

// How many pictures the field shows for several gifts
const FIELD_IMAGES = 3;

function GiftField({
  gifts,
  placeholder,
  multiple,
  selected,
  onApply,
}: CommonProps & {
  placeholder: string;
  multiple?: boolean;
  // Ids, maybe of gifts the list doesn't have
  selected: number[];
  onApply: (gifts: number[]) => void;
}) {
  const [open, setOpen] = useState(false);

  // In the list's order. Ids it doesn't have are still counted, the trigger
  // still reacts to them.
  const ids = new Set(selected);
  const known = gifts.filter((gift) => ids.has(gift.value));
  const only = selected.length === 1 ? known[0] : undefined;
  const images = known.filter((gift) => gift.img).slice(0, FIELD_IMAGES);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className={styles.field}
        title={
          known.length > 0
            ? formatList(known.map((gift) => gift.label))
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <span className={styles.field_label}>
          {selected.length === 0 ? (
            <span className={styles.placeholder}>{placeholder}</span>
          ) : (
            <>
              {images.length > 0 && (
                <span className={styles.field_images}>
                  {images.map((gift) => (
                    <img
                      key={gift.value}
                      src={gift.img}
                      alt=""
                      className={styles.field_img}
                    />
                  ))}
                </span>
              )}
              <span className={styles.name}>
                {only ? only.label : giftsLabel(selected.length)}
              </span>
              {only && (
                <span className={styles.details}>{coinsLabel(only.coins)}</span>
              )}
            </>
          )}
        </span>
        <FiChevronDown size={16} className={styles.chevron} />
      </button>

      {open &&
        createPortal(
          <GiftPicker
            gifts={gifts}
            selected={selected}
            multiple={multiple}
            onApply={(picked) => {
              onApply(picked);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
