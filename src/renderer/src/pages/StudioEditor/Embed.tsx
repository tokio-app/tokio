import { GamesOverlay } from "@/common/schemas";
import { GameOverlayRow, OverlayApp } from "@/common/types";
import { Iframe } from "@/components";
import { TimerPush } from "@/pages/CountdownTimer/helper";
import { TimerPreview } from "@/pages/CountdownTimer/sections/TimerPreview";
import { OverlayPreview } from "@/pages/Games/sections/OverlayPreview";
import { useT } from "@/ui/i18n";
import { ReactNode, useLayoutEffect, useRef } from "react";
import styles from "./studioeditor.module.css";
import { EmbedView } from "./StudioStage";

/**
 * Scales its content's own size to fit the box, centered, as a browser
 * source fits an overlay: close to the stream, not exact.
 */
function FitBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = box.current!;
    const inner = content.current!;
    const fit = () => {
      const { offsetWidth: width, offsetHeight: height } = inner;
      if (!width || !height) return;
      const scale = Math.min(
        outer.clientWidth / width,
        outer.clientHeight / height,
      );
      inner.style.setProperty("--fit", String(scale));
    };
    fit();
    // The transform doesn't change the sizes read, so this can't loop
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className={styles.fit}>
      <div ref={content} className={styles.fit_content}>
        {children}
      </div>
    </div>
  );
}

// A quiet box for what the editor can't draw
function Placeholder({ title, text }: { title?: string; text: string }) {
  return (
    <div className={styles.placeholder}>
      {title && <span className={styles.placeholder_title}>{title}</span>}
      <span>{text}</span>
    </div>
  );
}

type Props = {
  element: EmbedView;
  installed: OverlayApp[];
  timer: TimerPush | null;
  games: { look: GamesOverlay; rows: GameOverlayRow[] } | null;
};

/**
 * An embed as the editor shows it: an installed overlay from disk with its
 * own sample data, the timer's and games' previews scaled to the box, and an
 * alert's name, since its overlay shows media only while it plays.
 */
export function Embed({ element, installed, timer, games }: Props) {
  const t = useT();
  const { source } = element;
  let content: ReactNode;
  if (!source) {
    content = <Placeholder text={t("studio.embed.none")} />;
  } else if (source.type === "installed") {
    const app = element.src && installed.find((o) => o.id === source.id);
    // Named, so the overlay shows its own samples instead of trying a socket
    content = app ? (
      <Iframe source={app.path} name={app.id} transparent />
    ) : (
      <Placeholder text={t("studio.embed.removed")} />
    );
  } else if (source.type === "alert") {
    content = (
      <Placeholder title={element.label} text={t("studio.embed.alertPlays")} />
    );
  } else if (source.type === "timer") {
    content = timer && (
      <FitBox>
        <TimerPreview timer={timer} settings={timer.data.settings} bare />
      </FitBox>
    );
  } else {
    const { column } = source;
    // One column's page shows only that column's rows, as its only column
    const shown =
      games && column !== null
        ? {
            look: { ...games.look, columns: 1 },
            rows: games.rows
              .filter((row) => row.column === column)
              .map((row) => ({ ...row, column: 1 })),
          }
        : games;
    content = shown && (
      <FitBox>
        <OverlayPreview look={shown.look} rows={shown.rows} run={null} bare />
      </FitBox>
    );
  }
  return (
    <div className={styles.embed} aria-hidden>
      {content}
    </div>
  );
}
