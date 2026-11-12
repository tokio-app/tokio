import { useEffect, useState } from "react";

/**
 * Whether an element is in view, for lists of up to ~1000 files that mount a
 * player per row only while it shows. Pass `ref` as the element's ref.
 */
export function useNearView<T extends Element>() {
  const [element, ref] = useState<T | null>(null);
  // Not reset when the element changes: the player that replaces a
  // placeholder would flip back to it
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (!element) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const last = entries.at(-1);
      if (last) setNear(last.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, near] as const;
}
