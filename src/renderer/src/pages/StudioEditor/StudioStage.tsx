// The stream's own stylesheet, global as on its page, like the games
// overlay's preview: the canvas can't drift from what's on stream
import "@/common/studio/overlay.css";
import { createStage, Stage, StageFit } from "@/common/studio/stage";
import { StudioElementView, StudioView } from "@/common/types";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  bounds,
  Box,
  Corner,
  CORNERS,
  extent,
  holds,
  pickElement,
  Point,
  resizeBox,
  roundBox,
  toCanvas,
  turnTo,
} from "./helper";
import styles from "./studioeditor.module.css";

export type EmbedView = Extract<StudioElementView, { kind: "overlay" }>;

declare module "react" {
  interface CSSProperties {
    "--canvas-scale"?: number;
  }
}

type Props = {
  view: StudioView;
  // The stage, for Test to play its elements
  stageRef: RefObject<Stage | null>;
  // A layer's id or an element's
  selected: string | null;
  // The locked layers and elements, which the canvas can't pick, move,
  // resize or rotate
  locked: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  // An element moved or resized, rounded to whole px
  onBox: (id: string, box: Box) => void;
  // An element turned, in whole degrees
  onRotate: (id: string, rotation: number) => void;
  // Every element of a layer moved by whole px
  onShift: (layerId: string, dx: number, dy: number) => void;
  // An embed's preview, portaled into its slot
  embed: (element: EmbedView) => ReactNode;
};

type Drag =
  | {
      kind: "element";
      id: string;
      // The corner it resizes from, none to move it
      corner: Corner | null;
      // Where the pointer went down, and the box and turn then
      x: number;
      y: number;
      box: Box;
      rotation: number;
      scale: number;
    }
  | {
      kind: "rotate";
      id: string;
      // The element's center on screen
      center: Point;
    }
  | {
      kind: "layer";
      id: string;
      x: number;
      y: number;
      scale: number;
      // Where it went down on the canvas, picked from if it doesn't move
      point: Point;
      moved: boolean;
      // The whole px already sent
      sent: [number, number];
    };

const NO_FIT: StageFit = { scale: 0, left: 0, top: 0 };

// Each corner's handle, where it sits and its cursor
const HANDLES: Record<Corner, string> = {
  nw: styles.handle_nw,
  ne: styles.handle_ne,
  sw: styles.handle_sw,
  se: styles.handle_se,
};

// Screen px a press inside a layer's outline moves before it drags the layer
const DRAG_START = 3;

const sameFit = (a: StageFit, b: StageFit) =>
  a.scale === b.scale && a.left === b.left && a.top === b.top;

const boxOf = ({ x, y, width, height }: Box): Box => ({ x, y, width, height });

// The arrows' steps, Shift's ten times as far
const NUDGES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The overlay drawn by the stream's own renderer (stage.ts), with what the
 * editor adds over it: the selection's outline and resize handle, dragging,
 * and the arrows. A selected layer moves as one. Embeds are React's
 * previews, portaled into the stage's slots, which stay put so iframes don't
 * reload.
 */
export function StudioStage({
  view,
  stageRef,
  selected,
  locked,
  onSelect,
  onBox,
  onRotate,
  onShift,
  embed,
}: Props) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(NO_FIT);
  // Each embed's slot, which exists only once the stage drew its element
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLElement>>(
    new Map(),
  );
  const drag = useRef<Drag | null>(null);

  useLayoutEffect(() => {
    const stage = createStage(root.current!, { slots: true, editing: true });
    stageRef.current = stage;
    const refit = () =>
      setFit((last) => (sameFit(last, stage.fit()) ? last : stage.fit()));
    const observer = new ResizeObserver(refit);
    observer.observe(root.current!);
    return () => {
      observer.disconnect();
      stage.destroy();
      stageRef.current = null;
      setSlots(new Map());
    };
  }, [stageRef]);

  const elements = view.layers.flatMap((layer) =>
    layer.elements.map((element) => ({ element, layer: layer.id })),
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.update(view);
    setFit((last) => (sameFit(last, stage.fit()) ? last : stage.fit()));
    setSlots((last) => {
      const next = new Map<string, HTMLElement>();
      for (const layer of view.layers) {
        for (const element of layer.elements) {
          const slot = element.kind === "overlay" && stage.slot(element.id);
          if (slot) next.set(element.id, slot);
        }
      }
      const same =
        next.size === last.size &&
        [...next].every(([id, slot]) => last.get(id) === slot);
      return same ? last : next;
    });
  }, [view, stageRef]);

  /**
   * The height an element's text takes at that width, in px of the canvas,
   * 1 for one without text: the least its box can have. Measured on the
   * stage at that width, which the next update puts back.
   */
  const textHeight = (id: string, width: number, scale: number) => {
    const node = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-element]") ?? [],
    ).find((n) => n.dataset.element === id);
    const text = node?.querySelector(".studio-text");
    if (!node || !text || !scale) return 1;
    // Unturned, so the range's box is the words' own height
    const { width: keptWidth, transform } = node.style;
    node.style.width = `${width}px`;
    node.style.transform = "";
    const range = document.createRange();
    range.selectNodeContents(text);
    const { height } = range.getBoundingClientRect();
    node.style.width = keptWidth;
    node.style.transform = transform;
    return Math.max(1, Math.ceil(height / scale));
  };

  const chosen = elements.find(({ element }) => element.id === selected);
  const chosenLayer = view.layers.find((layer) => layer.id === selected);
  // The selection's outline: an element's box, turned with it, or around a
  // layer's elements
  const frame = chosen
    ? boxOf(chosen.element)
    : chosenLayer && bounds(chosenLayer.elements.map(extent));
  const stuck = chosen
    ? locked.has(chosen.layer) || locked.has(chosen.element.id)
    : locked.has(chosenLayer?.id ?? "");

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    // The keys go on from where it was clicked
    e.currentTarget.focus();
    e.preventDefault();
    const fitted = stageRef.current?.fit() ?? NO_FIT;
    const { scale } = fitted;
    if (!scale) return;
    const at = { x: e.clientX, y: e.clientY, scale };

    const handle = target.closest<HTMLElement>("[data-handle]");
    const corner = CORNERS.find((c) => c === handle?.dataset.handle);
    if (chosen && !stuck && corner) {
      const { element } = chosen;
      drag.current = {
        kind: "element",
        id: element.id,
        corner,
        box: boxOf(element),
        rotation: element.rotation,
        ...at,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const rect = root.current!.getBoundingClientRect();
    if (chosen && !stuck && handle?.dataset.handle === "rotate") {
      const { x, y, width, height } = chosen.element;
      drag.current = {
        kind: "rotate",
        id: chosen.element.id,
        center: {
          x: rect.left + fitted.left + (x + width / 2) * scale,
          y: rect.top + fitted.top + (y + height / 2) * scale,
        },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const point = toCanvas({ x: e.clientX, y: e.clientY }, rect, fitted);
    if (chosenLayer && frame && !stuck && holds(frame, point)) {
      // A click until it moves
      drag.current = {
        kind: "layer",
        id: chosenLayer.id,
        point,
        moved: false,
        sent: [0, 0],
        ...at,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const id = pickElement(view, locked, point);
    onSelect(id);
    const picked = elements.find(({ element }) => element.id === id);
    if (!picked) return;
    drag.current = {
      kind: "element",
      id: picked.element.id,
      corner: null,
      box: boxOf(picked.element),
      rotation: picked.element.rotation,
      ...at,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "rotate") {
      // Shift turns it in steps of 15 degrees
      const pointer = { x: e.clientX, y: e.clientY };
      onRotate(d.id, turnTo(d.center, pointer, e.shiftKey));
      return;
    }
    if (d.kind === "layer") {
      const sx = e.clientX - d.x;
      const sy = e.clientY - d.y;
      if (!d.moved && Math.hypot(sx, sy) < DRAG_START) return;
      d.moved = true;
      // Rounded once for all of them, so they keep their spacing
      const dx = Math.round(sx / d.scale);
      const dy = Math.round(sy / d.scale);
      if (dx === d.sent[0] && dy === d.sent[1]) return;
      onShift(d.id, dx - d.sent[0], dy - d.sent[1]);
      d.sent = [dx, dy];
      return;
    }
    // Screen px to the canvas's
    const dx = (e.clientX - d.x) / d.scale;
    const dy = (e.clientY - d.y) / d.scale;
    // A text's box can't get shorter than its words
    const minHeight = (width: number) => textHeight(d.id, width, d.scale);
    onBox(
      d.id,
      roundBox(
        d.corner
          ? resizeBox(d.box, d.corner, dx, dy, minHeight, d.rotation)
          : { ...d.box, x: d.box.x + dx, y: d.box.y + dy },
      ),
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "layer" && !d.moved) {
      onSelect(pickElement(view, locked, d.point));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!selected) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onSelect(null);
      return;
    }
    const nudge = NUDGES[e.key];
    if (!nudge || !frame) return;
    e.preventDefault();
    if (stuck) return;
    const step = e.shiftKey ? 10 : 1;
    if (chosenLayer) {
      onShift(chosenLayer.id, nudge[0] * step, nudge[1] * step);
      return;
    }
    onBox(
      selected,
      roundBox({
        ...frame,
        x: frame.x + nudge[0] * step,
        y: frame.y + nudge[1] * step,
      }),
    );
  };

  const rotation = chosen?.element.rotation ?? 0;
  const outline: CSSProperties | undefined = frame
    ? {
        left: fit.left + frame.x * fit.scale,
        top: fit.top + frame.y * fit.scale,
        width: frame.width * fit.scale,
        height: frame.height * fit.scale,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
      }
    : undefined;

  return (
    <div
      className={styles.stage}
      tabIndex={0}
      aria-label={t("studio.editor.canvas")}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Escape"
      // Hairlines drawn inside the scaled canvas stay one screen px
      style={{ "--canvas-scale": fit.scale || 1 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
    >
      <div ref={root} className={styles.stage_root} />
      {outline && (
        <div className={styles.selection} style={outline}>
          {chosen && !stuck && (
            <>
              {CORNERS.map((corner) => (
                <span
                  key={corner}
                  className={cx(styles.handle, HANDLES[corner])}
                  data-handle={corner}
                  title={t("studio.editor.resize")}
                />
              ))}
              <span
                className={styles.rotate}
                data-handle="rotate"
                title={t("studio.editor.rotate")}
              />
            </>
          )}
        </div>
      )}
      {elements.map(({ element }) => {
        if (element.kind !== "overlay") return null;
        const slot = slots.get(element.id);
        return slot ? createPortal(embed(element), slot, element.id) : null;
      })}
    </div>
  );
}
