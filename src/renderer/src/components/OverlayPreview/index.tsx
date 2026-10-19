import { OverlayApp } from "@/common/types";
import { ReactNode, Ref, useLayoutEffect, useRef, useState } from "react";
import { Iframe } from "../Iframe";
import styles from "./overlaypreview.module.css";

// Size overlays lay out at in the previews
export const PREVIEW = { width: 768, height: 432 };

interface Props {
  overlay: OverlayApp;
  ref?: Ref<HTMLIFrameElement>;
  onLoad?: () => void;
  // Drawn over the preview, e.g. buttons in a corner
  children?: ReactNode;
}

/**
 * An overlay laid out at the preview size and zoomed down to fit the width.
 */
export function OverlayPreview({ overlay, ref, onLoad, children }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() =>
      setZoom(el.clientWidth / PREVIEW.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frame} className={styles.frame}>
      <div style={{ ...PREVIEW, zoom }}>
        <Iframe
          ref={ref}
          name={overlay.id}
          source={overlay.path}
          onLoad={onLoad}
        />
      </div>
      {children}
    </div>
  );
}
