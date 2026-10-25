// The overlay's own stylesheet, global like on its page: the one deliberate
// exception to CSS Modules, so the preview can't drift from what's on stream
import "@/common/games/overlay.css";
import { GamesOverlay } from "@/common/schemas";
import { GameOverlayRow } from "@/common/types";
import { EmptyState } from "@/components";
import { cx } from "@/helper/cx";
import {
  CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "../games.module.css";

// The overlay's variables, which overlay.css reads
declare module "react" {
  interface CSSProperties {
    "--games-text"?: string;
    "--games-accent"?: string;
  }
}

// How long a row stays lit after its last run, as the overlay's LIT_MS
const LIT_MS = 1500;
// How long each of an event's gifts shows, as the overlay's ROTATE_MS
const ROTATE_MS = 2000;
// How long one at a time shows each row, as the overlay's TURN_MS
const TURN_MS = 3000;

// A font named by the streamer, with the overlay's as the fallback. One
// CSSOM property, so a name can't add any other style.
const fontFamily = (font: string) =>
  font.trim()
    ? `${JSON.stringify(font.trim())}, "Archivo Variable", sans-serif`
    : undefined;

// A Minecraft picture drawn at twice its size or more keeps its pixels sharp,
// as the overlay's sharpen does
const sharpen = (img: HTMLImageElement) =>
  img.classList.toggle(
    "games-pixelated",
    img.naturalWidth > 0 && img.naturalWidth * 2 <= img.clientWidth,
  );

/**
 * The turn of pictures that share one place, a gift's and the next's, as
 * the overlay counts them. Each picture shows while `turn % count` is its
 * index.
 */
export function usePictureTurn() {
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTurn((n) => n + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);
  return turn;
}

/** The overlay's pixel arrow, also the builder's rows' */
export function PixelArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 11 9" aria-hidden="true">
      <path d="M6 0H7V1H8V2H9V3H10V4H11V5H10V6H9V7H8V8H7V9H6V6H0V3H6Z" />
    </svg>
  );
}

type Props = {
  look: GamesOverlay;
  rows: GameOverlayRow[];
  // The last row Test lit; a new object each press
  run: { id: string } | null;
};

/**
 * The games overlay as it shows on stream, each column side by side, in the
 * markup of its page (src/main/services/server/games.html): keep the two in
 * step.
 */
export function OverlayPreview({ look, rows, run }: Props) {
  if (rows.length === 0) {
    return (
      <EmptyState>Pick a picture or name an action to show it here.</EmptyState>
    );
  }
  return (
    <div className={styles.preview}>
      {Array.from({ length: look.columns }, (_, i) => (
        <PreviewColumn
          key={i}
          label={
            look.columns > 1
              ? `Column ${i + 1} of the overlay preview`
              : "Overlay preview"
          }
          look={look}
          rows={rows.filter((row) => row.column === i + 1)}
          run={run}
        />
      ))}
    </div>
  );
}

// One column's overlay, at /games/minecraft/<column>/
function PreviewColumn({ label, look, rows, run }: Props & { label: string }) {
  const carousel = look.layout === "carousel";
  const [lit, setLit] = useState<string[]>([]);
  const [turn, setTurn] = useState(0);
  // Which of an event's gifts shows
  const pictureTurn = usePictureTurn();
  // Pictures that didn't load, hidden as on the overlay
  const [broken, setBroken] = useState<string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [prevRun, setPrevRun] = useState(run);

  // One at a time turns to the row Test lit
  if (run !== prevRun) {
    setPrevRun(run);
    if (run) {
      setLit((ids) => (ids.includes(run.id) ? ids : [...ids, run.id]));
      const index = rows.findIndex((row) => row.id === run.id);
      if (index !== -1) setTurn(index);
    }
  }

  // Presses in a row keep it lit, 1.5 s after the last
  useEffect(() => {
    if (!run) return;
    const all = timers.current;
    clearTimeout(all.get(run.id));
    all.set(
      run.id,
      setTimeout(() => {
        all.delete(run.id);
        setLit((ids) => ids.filter((id) => id !== run.id));
      }, LIT_MS),
    );
  }, [run]);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((timer) => clearTimeout(timer));
  }, []);

  // The lit rows as the turn's timeout finds them
  const litNow = useRef(lit);
  useEffect(() => {
    litNow.current = lit;
  }, [lit]);
  // Bumped to wait another turn
  const [wait, setWait] = useState(0);

  const current = rows.length > 0 ? turn % rows.length : 0;
  const currentId = rows.length > 0 ? rows[current].id : "";
  // A lit row holds its turn until it goes out, as on the overlay. Keyed by
  // the row's id, as the rows are a new array on every render.
  useEffect(() => {
    if (!carousel || rows.length < 2) return undefined;
    const next = setTimeout(() => {
      if (litNow.current.includes(currentId)) setWait((w) => w + 1);
      else setTurn(current + 1);
    }, TURN_MS);
    return () => clearTimeout(next);
  }, [carousel, rows.length, current, currentId, wait]);

  // Shrinks to fit its share of the preview, as the overlay fits its source.
  // Written to the style, so measuring doesn't render again.
  const box = useRef<HTMLDivElement>(null);
  const games = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const room = box.current?.clientWidth;
      const content = games.current;
      if (!room || !content) return;
      content.style.setProperty("--fit", "1");
      const scale = Math.min(1, room / content.offsetWidth);
      content.style.setProperty("--fit", String(scale));
      content
        .querySelectorAll<HTMLImageElement>(".games-slot-result img")
        .forEach(sharpen);
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  });

  const style = {
    "--games-text": look.text_color,
    "--games-accent": look.accent_color,
    fontFamily: fontFamily(look.font),
  } satisfies CSSProperties;

  return (
    <div ref={box} className={styles.preview_column}>
      <div
        ref={games}
        className={cx(
          "games",
          carousel && "games-carousel",
          look.pictures_only && "games-pictures-only",
        )}
        style={style}
      >
        <ol className="games-rows" aria-label={label}>
          {rows.map((row, index) => {
            const pictures = row.pictures.filter(
              (src) => !broken.includes(src),
            );
            const image =
              row.image && !broken.includes(row.image) ? row.image : null;
            const onError = (src: string) => () =>
              setBroken((all) => (all.includes(src) ? all : [...all, src]));
            return (
              <li
                key={row.id}
                className={cx(
                  "games-row",
                  lit.includes(row.id) && "games-lit",
                  index === current && "games-current",
                )}
              >
                <span
                  className={cx(
                    "games-side games-event",
                    pictures.length > 0 && "has-picture",
                  )}
                >
                  <span className="games-text">{row.event}</span>
                  {pictures.length > 0 && (
                    <span className="games-slot">
                      {pictures.map((src, i) => (
                        <img
                          key={src}
                          className={cx(
                            i !== pictureTurn % pictures.length && "games-away",
                          )}
                          src={src}
                          alt=""
                          onError={onError(src)}
                        />
                      ))}
                    </span>
                  )}
                </span>
                <PixelArrow className="games-arrow" />
                <span
                  className={cx(
                    "games-side games-result",
                    image && "has-picture",
                  )}
                >
                  {image && (
                    <span className="games-slot games-slot-result">
                      <img
                        src={image}
                        alt=""
                        onLoad={(e) => sharpen(e.currentTarget)}
                        onError={onError(image)}
                      />
                    </span>
                  )}
                  {row.name && (
                    <span className="games-text games-name">{row.name}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
