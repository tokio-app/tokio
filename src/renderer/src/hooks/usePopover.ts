import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useClickOutside } from "./useClickOutside";

// In the window, as the popover is fixed: top under the anchor, bottom over it
type Position = { top?: number; bottom?: number; left: number; width: number };

/**
 * State for a popover rendered in a portal under its anchor, or over it when
 * it doesn't fit below and there's more room above. One too wide for the
 * window's right moves left until it fits, the gap from the edge. It closes
 * on a click outside the anchor and the popover, and when something else
 * scrolls.
 */
export function usePopover(gap = 4) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({
    top: 0,
    left: 0,
    width: 0,
  });

  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (!open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + gap,
        left: rect.left,
        width: rect.width,
      });
    }
    setOpen(!open);
  };

  // Measured where toggle put it, before it's painted. Over the anchor it's
  // pinned by its bottom, so a search that shortens a list keeps it there.
  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const popover = popoverRef.current;
    if (!open || !anchor || !popover?.offsetHeight) return;
    const below = window.innerHeight - anchor.bottom - gap;
    const above = anchor.top - gap;
    const over = popover.offsetHeight > below && above > below;
    const left = Math.max(
      0,
      Math.min(anchor.left, window.innerWidth - popover.offsetWidth - gap),
    );
    if (!over && left === anchor.left) return;
    setPosition({
      ...(over
        ? { bottom: window.innerHeight - anchor.top + gap }
        : { top: anchor.bottom + gap }),
      left,
      width: anchor.width,
    });
  }, [open, gap]);

  useClickOutside([anchorRef, popoverRef], close, open);

  useEffect(() => {
    if (!open) return undefined;

    // The popover doesn't follow its anchor, so close it instead.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  return { open, toggle, close, position, anchorRef, popoverRef };
}
