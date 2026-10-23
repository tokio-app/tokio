import { KeyboardEvent, useRef, useState } from "react";
import { useClickOutside } from "./useClickOutside";

/**
 * State for a menu under its toggle button. It closes on a click outside
 * `ref`, and on Escape, which gives the focus back to the toggle.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useClickOutside([ref], () => setOpen(false), open);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  return {
    open,
    ref,
    toggleRef,
    toggle: () => setOpen((o) => !o),
    close,
    // For the container's onKeyDown
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open) return;
      e.stopPropagation();
      close();
    },
  };
}
