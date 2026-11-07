import { StageFit } from "@/common/studio/stage";
import { RefObject, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { rulerTicks } from "./helper";
import styles from "./studioeditor.module.css";

// A ruler's thickness, the frame's track (--space-5)
const SIZE = 20;
// How far each tick reaches in from the ruler's inner edge
const REACH = { number: SIZE, half: 8, tick: 4 } as const;

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
};

/**
 * Rulers along the stage's top and left, in canvas px from the canvas's
 * top-left corner. They follow the zoom and the scroll: measured on each
 * scroll in its own state, so a scroll draws only them.
 */
export function Rulers({ scroller, root, fit }: Props) {
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

  return (
    <>
      <span className={styles.ruler_corner} aria-hidden />
      <Ruler
        side="top"
        origin={place.x}
        scale={fit.scale}
        length={place.width}
      />
      <Ruler
        side="left"
        origin={place.y}
        scale={fit.scale}
        length={place.height}
      />
    </>
  );
}

function Ruler({
  side,
  origin,
  scale,
  length,
}: {
  side: "top" | "left";
  origin: number;
  scale: number;
  length: number;
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
  return (
    <svg
      className={top ? styles.ruler_top : styles.ruler_left}
      aria-hidden
      data-ruler={side}
    >
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
    </svg>
  );
}
