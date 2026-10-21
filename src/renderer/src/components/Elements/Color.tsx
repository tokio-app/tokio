import { cx } from "@/helper/cx";
import { usePopover } from "@/hooks/usePopover";
import { useRef, useState } from "react";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { createPortal } from "react-dom";
import styles from "./elements.module.css";

type Props = {
  // A color like #ff000080
  value: string;
  onChange: (color: string) => void;
};

// The field also takes #rgb and #rgba, the settings want 6 or 8 digits
const fullHex = (color: string) =>
  color.length > 5 ? color : color.replace(/\w/g, "$&$&");

export function Color({ value, onChange }: Props) {
  const { open, toggle, close, position, anchorRef, popoverRef } =
    usePopover(8);
  const swatchRef = useRef<HTMLButtonElement>(null);
  // The color as typed, while the field has the focus
  const [typed, setTyped] = useState<string | null>(null);
  if (!open && typed !== null) setTyped(null);

  return (
    // The picker is portaled, but its keys still bubble up here
    <div
      ref={anchorRef}
      className={styles.color_anchor}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Tab") {
          // The picker is portaled after the page, so Tab out of it would
          // leave a dialog it's in: it goes back to the swatch instead
          const items =
            popoverRef.current?.querySelectorAll<HTMLElement>(
              "[tabindex], input",
            ) ?? [];
          const edge = e.shiftKey ? items[0] : items[items.length - 1];
          if (!edge || document.activeElement !== edge) return;
          e.preventDefault();
        } else if (e.key === "Escape") {
          // Closes the picker, not a modal it's in
          e.stopPropagation();
        } else {
          return;
        }
        close();
        swatchRef.current?.focus();
      }}
    >
      <button
        ref={swatchRef}
        type="button"
        className={styles.color_swatch}
        style={{ backgroundColor: value }}
        onClick={toggle}
        aria-label="Choose color"
        aria-expanded={open}
      />

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={cx(styles.popover, styles.color_popover)}
            style={{ top: position.top, left: position.left }}
          >
            <HexAlphaColorPicker
              className={styles.picker}
              color={value}
              onChange={onChange}
            />
            <HexColorInput
              className={styles.color_input}
              // The full value would rewrite a short color as it's typed
              color={typed ?? value}
              onChange={(color) => {
                setTyped(color);
                onChange(fullHex(color));
              }}
              onBlur={() => setTyped(null)}
              placeholder="Type a color"
              // The picker is portaled out of the Tab order, so it takes the focus
              autoFocus
              prefixed
              alpha
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
