import { StageFit } from "@/common/studio/stage";
import { useT } from "@/ui/i18n";
import { PointerEvent, RefObject, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Axis, rulerTicks } from "./helper";
import styles from "./studioeditor.module.css";

// A ruler's thickness, the frame's track (--space-5)
const SIZE = 20;
// How far each tick reaches in from the ruler's inner edge
const REACH = { number: SIZE, half: 8, tick: 4 } as const;
// A dragged guide's label: its height, and each digit's room in it
const MARK_HEIGHT = 16;
const DIGIT = 7;

// Where the canvas's corner sits in the stage's view, and the view's size
type Place = { x: number; y: number; width: number; height: number };

const samePlace = (a: Place, b: Place) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

type Props = {
  // The view that scrolls the canvas, and the stage's root it's drawn in
  scroller: RefObject<HTMLElement | null>;
  root: RefObject<HTMLElement | null>;
  // Where the canvas sits in the root, and its scale
  fit: StageFit;
  // Ctrl or Cmd and a press: a guide to drag, horizontal from the top
  // ruler (y) and vertical from the left one (x)
  onGuide: (e: PointerEvent, axis: Axis) => void;
  // The guide being dragged, whose place its ruler shows
  mark: { axis: Axis; at: number } | null;
};

/**
 * Rulers along the stage's top and left, in canvas px from the canvas's
 * top-left corner. They follow the zoom and the scroll: measured on each
 * scroll in its own state, so a scroll draws only them. Ctrl and a drag from
 * one brings out a guide.
 */
export function Rulers({ scroller, root, fit, onGuide, mark }: Props) {
  const t = useT();
  const [place, setPlace] = useState<Place>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  useLayoutEffect(() => {
    const pane = scroller.current;
    const canvas = root.current;
    if (!pane || !canvas) return undefined;
    const measure = () => {
      const view = pane.getBoundingClientRect();
      const box = canvas.getBoundingClientRect();
      const next = {
        x: box.left + fit.left - view.left - pane.clientLeft,
        y: box.top + fit.top - view.top - pane.clientTop,
        width: pane.clientWidth,
        height: pane.clientHeight,
      };
      setPlace((last) => (samePlace(last, next) ? last : next));
    };
    measure();
    // In the frame the canvas moved in, not the one after
    const now = () => flushSync(measure);
    pane.addEventListener("scroll", now, { passive: true });
    const observer = new ResizeObserver(now);
    observer.observe(pane);
    observer.observe(canvas);
    return () => {
      pane.removeEventListener("scroll", now);
      observer.disconnect();
    };
  }, [scroller, root, fit]);

  const hint = t("studio.editor.guideHint");
  // A vertical guide's place is across, on the top ruler
  const markOn = (axis: Axis) => (mark?.axis === axis ? mark.at : null);

  return (
    <>
      <span className={styles.ruler_corner} aria-hidden />
      <Ruler
        side="top"
        origin={place.x}
        scale={fit.scale}
        length={place.width}
        hint={hint}
        mark={markOn("x")}
        onGuide={(e) => onGuide(e, "y")}
      />
      <Ruler
        side="left"
        origin={place.y}
        scale={fit.scale}
        length={place.height}
        hint={hint}
        mark={markOn("y")}
        onGuide={(e) => onGuide(e, "x")}
      />
    </>
  );
}

function Ruler({
  side,
  origin,
  scale,
  length,
  hint,
  mark,
  onGuide,
}: {
  side: "top" | "left";
  origin: number;
  scale: number;
  length: number;
  hint: string;
  // A dragged guide's place on this ruler, in px of the canvas
  mark: number | null;
  onGuide: (e: PointerEvent) => void;
}) {
  const ticks = rulerTicks(origin, scale, length);
  const top = side === "top";
  // One path for every tick, each a crisp screen px wide
  const path = ticks
    .map(({ at, size }) => {
      const p = Math.round(at) + 0.5;
      const from = SIZE - REACH[size];
      return top ? `M${p} ${from}V${SIZE}` : `M${from} ${p}H${SIZE}`;
    })
    .join("");
  const label = mark === null ? "" : String(mark);
  const width = label.length * DIGIT + 8;
  const marked = origin + (mark ?? 0) * scale;
  return (
    <svg
      className={top ? styles.ruler_top : styles.ruler_left}
      aria-hidden
      data-ruler={side}
      onPointerDown={(e) => {
        if (e.button === 0 && (e.ctrlKey || e.metaKey)) onGuide(e);
      }}
    >
      <title>{hint}</title>
      <path d={path} />
      {ticks
        .filter((tick) => tick.size === "number")
        .map(({ at, value }) =>
          top ? (
            <text key={value} x={at + 3} y={11}>
              {value}
            </text>
          ) : (
            // Turned to read upward, just past its tick
            <text
              key={value}
              transform={`translate(11 ${at + 3}) rotate(-90)`}
              textAnchor="end"
            >
              {value}
            </text>
          ),
        )}
      {mark !== null && (
        // Centered on its place, over the ticks, turned on the left ruler
        <g
          className={styles.ruler_mark}
          transform={
            top
              ? `translate(${marked} ${SIZE / 2})`
              : `translate(${SIZE / 2} ${marked}) rotate(-90)`
          }
          data-mark={label}
        >
          <rect
            x={-width / 2}
            y={-MARK_HEIGHT / 2}
            width={width}
            height={MARK_HEIGHT}
            rx={2}
          />
          <text textAnchor="middle" dominantBaseline="central">
            {label}
          </text>
        </g>
      )}
    </svg>
  );
}
