// The stream's own stylesheet, global as on its page, like the games
// overlay's preview: the canvas can't drift from what's on stream
import "@/common/studio/overlay.css";
import { STUDIO_MAX_GUIDES, StudioGuides } from "@/common/schemas";
import { createStage, Stage, StageFit } from "@/common/studio/stage";
import { StudioElementView, StudioView } from "@/common/types";
import { Btn } from "@/components";
import { cx } from "@/helper/cx";
import { useLanguage, useT } from "@/ui/i18n";
import isEqual from "fast-deep-equal";
import {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { LuMaximize, LuRuler, LuZoomIn, LuZoomOut } from "react-icons/lu";
import {
  Axis,
  Box,
  clampZoom,
  Corner,
  CORNERS,
  fitText,
  guideAt,
  holdsTurned,
  MetLine,
  metLines,
  nearGuide,
  pickElement,
  Point,
  resizeBox,
  rotateCursor,
  roundBox,
  snapBox,
  SnapLine,
  SnapLines,
  snapLines,
  stickCorner,
  toCanvas,
  turnTo,
  Turned,
  withGuide,
  Words,
  zoomStep,
} from "./helper";
import { Rulers } from "./Rulers";
import styles from "./studioeditor.module.css";

export type EmbedView = Extract<StudioElementView, { kind: "overlay" }>;

declare module "react" {
  interface CSSProperties {
    "--canvas-scale"?: number;
  }
}

declare global {
  // Chromium takes it; TypeScript's DOM types don't have it yet
  interface FocusOptions {
    focusVisible?: boolean;
  }
}

type Props = {
  view: StudioView;
  // The stage, for Test to play its elements
  stageRef: RefObject<Stage | null>;
  // A text whose words its settings just changed, grown to them once drawn
  fitting: RefObject<string | null>;
  // The selected text's words, measured each time they change, null for
  // none
  onWords: (words: Words | null) => void;
  // A group's id or an element's
  selected: string | null;
  // The locked groups and elements, which the canvas can't pick, move,
  // resize or rotate
  locked: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  // An element moved or resized, rounded to whole px
  onBox: (id: string, box: Box) => void;
  // An element turned, in whole degrees
  onRotate: (id: string, rotation: number) => void;
  // Every element of a group moved by whole px
  onShift: (groupId: string, dx: number, dy: number) => void;
  // The selected group's frame, around its elements as they show
  groupFrame: Turned | null;
  // A group resized or turned from the frame it had when the drag began
  onGroupFrame: (groupId: string, from: Turned, to: Turned) => void;
  // The corners keep the width and height in proportion
  linked: boolean;
  // The rulers show, with the guides, and the overlay saves whether they do
  rulers: boolean;
  onRulers: (on: boolean) => void;
  // The overlay's guides, which a drag sticks to while they show
  guides: StudioGuides;
  // A guide added, moved or taken away on the canvas
  onGuides: (guides: StudioGuides) => void;
  // A drag on the canvas begins (true) and ends: every change in between is
  // one step of the history
  onHold: (held: boolean) => void;
  // Deletes a group with its elements, or an element
  onDelete: (id: string) => void;
  // An embed's preview, portaled into its slot
  embed: (element: EmbedView) => ReactNode;
  // The bar under the canvas, beside its zoom: its size
  children?: ReactNode;
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
      // What it sticks to
      lines: SnapLines;
    }
  | {
      kind: "rotate";
      id: string;
      // The element's or group's center on screen
      center: Point;
      // A group's frame when it began
      frame?: Turned;
    }
  | {
      kind: "frame";
      id: string;
      corner: Corner;
      // Where the pointer went down, and the group's frame then
      x: number;
      y: number;
      frame: Turned;
      scale: number;
      lines: SnapLines;
    }
  | {
      kind: "group";
      id: string;
      x: number;
      y: number;
      scale: number;
      // Where it went down on the canvas, picked from if it doesn't move
      point: Point;
      moved: boolean;
      // The whole px already sent
      sent: [number, number];
      // Its frame when it began, and what that sticks to
      frame: Turned;
      lines: SnapLines;
    }
  | {
      kind: "pan";
      // Where the pointer went down, and how far the view was scrolled then
      x: number;
      y: number;
      left: number;
      top: number;
    }
  | {
      kind: "guide";
      axis: Axis;
      // Its place among that axis's guides, null for one from a ruler
      index: number | null;
      // Where it is, in whole px of the canvas, null while the pointer is
      // off the view: let go there, it goes
      at: number | null;
      // What it sticks to on its axis
      lines: SnapLine[];
    };

// The cursor a drag keeps on the whole stage: a guide's is its axis's
type Held = "rotate" | "move" | "pan" | Axis | Corner;

// What a press where the pointer is would drag, for its cursor
type Over = "move" | Axis | null;

// A guide being dragged, drawn where it is
type Moving = { axis: Axis; index: number | null; at: number | null };

const NO_FIT: StageFit = { scale: 0, left: 0, top: 0 };

// Each corner's handle, where it sits and its cursor
const HANDLES: Record<Corner, string> = {
  nw: styles.handle_nw,
  ne: styles.handle_ne,
  sw: styles.handle_sw,
  se: styles.handle_se,
};

// The cursor of each drag, which the stage keeps while it lasts, and of
// what a press would drag. Turning has its own, along its circle.
const CURSORS: Record<Exclude<Held, "rotate">, string> = {
  move: "move",
  pan: "grabbing",
  x: "col-resize",
  y: "row-resize",
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

// Screen px a press inside a group's outline moves before it drags the group
const DRAG_START = 3;
// Screen px within which a dragged edge, middle or corner sticks to a line
const SNAP_REACH = 6;
// Screen px from a guide that Ctrl and a press take it
const GUIDE_REACH = 4;

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
 * the arrows and Delete. A selected group moves as one. Embeds are React's
 * previews, portaled into the stage's slots, which stay put so iframes don't
 * reload. It zooms and scrolls, with rulers and guides while they're on, and
 * its bar under it holds the zoom. A drag sticks to the canvas's edges and
 * middle, the other elements' and the guides, with rose lines for what it
 * lines up with, unless Alt is down.
 */
export function StudioStage({
  view,
  stageRef,
  fitting,
  onWords,
  selected,
  locked,
  onSelect,
  onBox,
  onRotate,
  onShift,
  groupFrame,
  onGroupFrame,
  linked,
  rulers,
  onRulers,
  guides,
  onGuides,
  onHold,
  onDelete,
  embed,
  children,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const root = useRef<HTMLDivElement>(null);
  // The focusable stage, and the view inside it that scrolls a zoomed canvas
  const stageEl = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(NO_FIT);
  // Each embed's slot, which exists only once the stage drew its element
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLElement>>(
    new Map(),
  );
  const drag = useRef<Drag | null>(null);
  // The cursor a drag keeps on the whole stage, wherever the pointer goes:
  // the rotate cursor while it turns, the move cursor, a corner's resize, or
  // the closed hand while it pans
  const [held, setHeld] = useState<Held | null>(null);
  // What the pointer is over that a press would drag: an element or the
  // selected group's outline, or a guide while Ctrl or Cmd is down
  const [over, setOver] = useState<Over>(null);
  // The canvas's scale, null while it fits the stage
  const [zoom, setZoom] = useState<number | null>(null);
  // A canvas point to keep where it is on screen across a zoom
  const anchor = useRef<{ point: Point; x: number; y: number } | null>(null);
  // Space is down, with the canvas focused or nothing: a drag pans
  const [space, setSpace] = useState(false);
  // The guide being dragged, and the rose lines of what a drag lines up with
  const [moving, setMoving] = useState<Moving | null>(null);
  const [met, setMet] = useState<MetLine[]>([]);
  const percent = useMemo(
    () => new Intl.NumberFormat(language, { style: "percent" }),
    [language],
  );
  // The scale shown: the zoom's, or the fit's
  const level = zoom ?? fit.scale;

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

  // After a zoom: the outline at once, not a frame late, and the canvas point
  // the zoom kept back where it was on screen
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pane = scroller.current;
    const kept = anchor.current;
    anchor.current = null;
    if (!stage || !pane) return;
    const fitted = stage.fit();
    setFit((last) => (sameFit(last, fitted) ? last : fitted));
    if (!kept || !fitted.scale) return;
    const rect = root.current!.getBoundingClientRect();
    pane.scrollLeft +=
      rect.left + fitted.left + kept.point.x * fitted.scale - kept.x;
    pane.scrollTop +=
      rect.top + fitted.top + kept.point.y * fitted.scale - kept.y;
  }, [zoom, stageRef]);

  // The scale now, for a zoom from it: the fit's from the stage itself
  const scaleNow = () => zoom ?? stageRef.current?.fit().scale ?? 0;

  /**
   * Zooms to a scale, null to fit, keeping the canvas point under `at` on
   * screen where it is: the pointer's, or else the stage's middle.
   */
  const zoomTo = (next: number | null, at?: Point) => {
    const pane = scroller.current;
    const fitted = stageRef.current?.fit();
    if (!pane || !fitted?.scale) return;
    const rect = pane.getBoundingClientRect();
    const spot = at ?? {
      x: rect.left + pane.clientWidth / 2,
      y: rect.top + pane.clientHeight / 2,
    };
    anchor.current = {
      point: toCanvas(spot, root.current!.getBoundingClientRect(), fitted),
      ...spot,
    };
    // At once, so the wheel's next step starts from this one
    flushSync(() => setZoom(next === null ? null : clampZoom(next)));
  };

  const stepZoom = (by: 1 | -1) => {
    const next = zoomStep(scaleNow(), by);
    if (next !== null) zoomTo(next);
  };

  // Ctrl or Cmd with the wheel, and a trackpad's pinch, zoom at the pointer.
  // A native listener: React's can't keep the wheel from scrolling.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (drag.current) return;
    zoomTo(scaleNow() * 1.2 ** (-e.deltaY / 100), {
      x: e.clientX,
      y: e.clientY,
    });
  });
  useEffect(() => {
    const el = stageEl.current!;
    const listener = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);

  // Ctrl or Cmd with = or + zooms in, with - out, and with 0 fits, in place
  // of the window's own zoom, and with R shows or hides the rulers, in place
  // of a reload, anywhere in the editor but a dialog. Space, with the canvas
  // focused or nothing, lets a drag pan: a field or a button keeps its own.
  const onKey = useEffectEvent((e: globalThis.KeyboardEvent, down: boolean) => {
    const target = e.target instanceof Element ? e.target : null;
    if (e.key === " ") {
      if (!down) setSpace(false);
      else if (target === stageEl.current || target === document.body) {
        e.preventDefault();
        setSpace(true);
      }
      return;
    }
    if (!down || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (target?.closest("[role=dialog]")) return;
    if (e.key === "=" || e.key === "+") stepZoom(1);
    else if (e.key === "-") stepZoom(-1);
    else if (e.key === "0") zoomTo(null);
    // Not with Shift, which still reloads the window from scratch
    else if (e.key.toLowerCase() === "r" && !e.shiftKey) onRulers(!rulers);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => onKey(e, true);
    const up = (e: globalThis.KeyboardEvent) => onKey(e, false);
    const away = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", away);
    };
  }, []);

  const nodeOf = (id: string) =>
    Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-element]") ?? [],
    ).find((n) => n.dataset.element === id);

  /**
   * The height an element's text takes at that width, in px of the canvas,
   * 1 for one without text: the least its box can have. Measured on the
   * stage at that width, which the next update puts back.
   */
  const textHeight = (id: string, width: number, scale: number) => {
    const node = nodeOf(id);
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

  /**
   * The width of an element's longest word, in px of the canvas, 1 for one
   * without text: the least its box can have, so its words never break and
   * its height can't run away. Measured on the stage, unturned, with the text
   * as narrow as its words let it be.
   */
  const textWidth = (id: string, scale: number) => {
    const node = nodeOf(id);
    const text = node?.querySelector<HTMLElement>(".studio-text");
    if (!node || !text || !scale) return 1;
    const { transform } = node.style;
    const { width, overflowWrap } = text.style;
    node.style.transform = "";
    text.style.width = "min-content";
    // On stream a word too long for its box breaks anywhere
    text.style.overflowWrap = "normal";
    const measured = text.getBoundingClientRect().width;
    node.style.transform = transform;
    text.style.width = width;
    text.style.overflowWrap = overflowWrap;
    return Math.max(1, Math.ceil(measured / scale));
  };

  // As a corner drag stops at them: a bigger size, another font or more
  // words would spill out of the box, which only a drag set right before
  useLayoutEffect(() => {
    const id = fitting.current;
    if (!id) return;
    fitting.current = null;
    const text = elements.find(({ element }) => element.id === id)?.element;
    const scale = stageRef.current?.fit().scale;
    if (text?.kind !== "text" || !scale) return;
    const fitted = fitText(text, text.align, textWidth(id, scale), (width) =>
      textHeight(id, width, scale),
    );
    if (fitted) onBox(id, fitted);
  });

  // For its fields, which keep to them as a corner drag does
  const measured = useRef<{ key: string } | null>(null);
  useLayoutEffect(() => {
    const text = elements.find(
      ({ element }) => element.id === selected,
    )?.element;
    const scale = stageRef.current?.fit().scale;
    const words: Words | null =
      text?.kind === "text" && scale
        ? {
            id: text.id,
            width: textWidth(text.id, scale),
            height: textHeight(text.id, text.width, scale),
            heightAt: (width) => textHeight(text.id, width, scale),
          }
        : null;
    const key = words
      ? [words.id, words.width, words.height, scale].join(" ")
      : "";
    if (measured.current?.key === key) return;
    measured.current = { key };
    onWords(words);
  });

  const chosen = elements.find(({ element }) => element.id === selected);
  // A group's layer only: an element on its own has its layer's id, and
  // stays an element
  const chosenGroup = chosen
    ? undefined
    : view.layers.find((layer) => layer.id === selected);
  // The selection's outline: an element's box, or a group's frame, turned
  const frame = chosen
    ? boxOf(chosen.element)
    : chosenGroup && groupFrame
      ? boxOf(groupFrame)
      : undefined;
  const rotation = chosen
    ? chosen.element.rotation
    : (groupFrame?.rotation ?? 0);
  const stuck = chosen
    ? locked.has(chosen.layer) || locked.has(chosen.element.id)
    : locked.has(chosenGroup?.id ?? "");

  // A drag from a press, its cursor kept on the whole stage until it ends,
  // and one step of the history. The stage takes the pointer, so a press on
  // a ruler drags on it too.
  const start = (e: PointerEvent, d: Drag, cursor: Held) => {
    drag.current = d;
    setHeld(cursor);
    onHold(true);
    stageEl.current!.setPointerCapture(e.pointerId);
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setHeld(null);
    setMoving(null);
    setMet([]);
    onHold(false);
  };

  // What a drag sticks to: the canvas, the elements it doesn't move, and the
  // guides while they show
  const linesBut = (moves: (layer: string, id: string) => boolean) =>
    snapLines(
      view,
      elements
        .filter(({ element, layer }) => !moves(layer, element.id))
        .map(({ element }) => element),
      rulers ? guides : null,
    );

  const showMet = (next: MetLine[]) =>
    setMet((last) => (isEqual(last, next) ? last : next));

  // A guide dragged from a ruler (`index` null) or from where it is, unless
  // they're locked. It sticks to the canvas and every element.
  const startGuide = (e: PointerEvent, axis: Axis, index: number | null) => {
    if (guides.locked) return;
    if (index === null && guides[axis].length >= STUDIO_MAX_GUIDES) return;
    e.preventDefault();
    const at = index === null ? null : guides[axis][index];
    const lines = snapLines(
      view,
      elements.map(({ element }) => element),
      null,
    )[axis];
    start(e, { kind: "guide", axis, index, at, lines }, axis);
    setMoving({ axis, index, at });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    // Its view's own scrollbars: they scroll, and pick nothing
    if (target === scroller.current) return;
    // The keys go on from where it was clicked. No ring around the whole
    // canvas for a click: Chromium would ring it after a field had the focus.
    // Tab still rings it.
    e.currentTarget.focus({ focusVisible: false });
    e.preventDefault();
    if (space) {
      const pane = scroller.current!;
      start(
        e,
        {
          kind: "pan",
          x: e.clientX,
          y: e.clientY,
          left: pane.scrollLeft,
          top: pane.scrollTop,
        },
        "pan",
      );
      return;
    }
    const fitted = stageRef.current?.fit() ?? NO_FIT;
    const { scale } = fitted;
    if (!scale) return;
    const at = { x: e.clientX, y: e.clientY, scale };
    const rect = root.current!.getBoundingClientRect();
    const point = toCanvas({ x: e.clientX, y: e.clientY }, rect, fitted);

    // Ctrl or Cmd takes a guide it's on, before what's under it
    const guide =
      rulers && !guides.locked && (e.ctrlKey || e.metaKey)
        ? nearGuide(point, guides, GUIDE_REACH / scale)
        : null;
    if (guide) {
      startGuide(e, guide.axis, guide.index);
      return;
    }

    const handle = target.closest<HTMLElement>("[data-handle]");
    const corner = CORNERS.find((c) => c === handle?.dataset.handle);
    if (chosenGroup && groupFrame && !stuck && corner) {
      const group = chosenGroup.id;
      start(
        e,
        {
          kind: "frame",
          id: group,
          corner,
          frame: groupFrame,
          lines: linesBut((layer) => layer === group),
          ...at,
        },
        corner,
      );
      return;
    }
    if (chosen && !stuck && corner) {
      const { element } = chosen;
      start(
        e,
        {
          kind: "element",
          id: element.id,
          corner,
          box: boxOf(element),
          rotation: element.rotation,
          lines: linesBut((_, id) => id === element.id),
          ...at,
        },
        corner,
      );
      return;
    }

    if (chosen && !stuck && handle?.dataset.handle === "rotate") {
      const { x, y, width, height } = chosen.element;
      start(
        e,
        {
          kind: "rotate",
          id: chosen.element.id,
          center: {
            x: rect.left + fitted.left + (x + width / 2) * scale,
            y: rect.top + fitted.top + (y + height / 2) * scale,
          },
        },
        "rotate",
      );
      return;
    }
    if (
      chosenGroup &&
      groupFrame &&
      !stuck &&
      handle?.dataset.handle === "rotate"
    ) {
      const { x, y, width, height } = groupFrame;
      start(
        e,
        {
          kind: "rotate",
          id: chosenGroup.id,
          center: {
            x: rect.left + fitted.left + (x + width / 2) * scale,
            y: rect.top + fitted.top + (y + height / 2) * scale,
          },
          frame: groupFrame,
        },
        "rotate",
      );
      return;
    }

    if (
      chosenGroup &&
      frame &&
      !stuck &&
      holdsTurned({ ...frame, rotation }, point)
    ) {
      // A click until it moves
      const group = chosenGroup.id;
      start(
        e,
        {
          kind: "group",
          id: group,
          point,
          moved: false,
          sent: [0, 0],
          frame: { ...frame, rotation },
          lines: linesBut((layer) => layer === group),
          ...at,
        },
        "move",
      );
      return;
    }

    const id = pickElement(view, locked, point);
    onSelect(id);
    const picked = elements.find(({ element }) => element.id === id);
    if (!picked) return;
    start(
      e,
      {
        kind: "element",
        id: picked.element.id,
        corner: null,
        box: boxOf(picked.element),
        rotation: picked.element.rotation,
        lines: linesBut((_, other) => other === id),
        ...at,
      },
      "move",
    );
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      // What a press here would drag shows its cursor
      const fitted = stageRef.current?.fit() ?? NO_FIT;
      if (!fitted.scale) return;
      const point = toCanvas(
        { x: e.clientX, y: e.clientY },
        root.current!.getBoundingClientRect(),
        fitted,
      );
      const guide =
        rulers && !guides.locked && (e.ctrlKey || e.metaKey)
          ? nearGuide(point, guides, GUIDE_REACH / fitted.scale)
          : null;
      const next: Over = guide
        ? guide.axis
        : pickElement(view, locked, point) !== null ||
            (!!chosenGroup &&
              !!frame &&
              !stuck &&
              holdsTurned({ ...frame, rotation }, point))
          ? "move"
          : null;
      if (next !== over) setOver(next);
      return;
    }
    if (d.kind === "guide") {
      // On the view it stays where it's let go, off it it goes
      const pane = scroller.current!;
      const seen = pane.getBoundingClientRect();
      const inside =
        e.clientX >= seen.left &&
        e.clientX < seen.left + pane.clientWidth &&
        e.clientY >= seen.top &&
        e.clientY < seen.top + pane.clientHeight;
      const fitted = stageRef.current?.fit();
      let at: number | null = null;
      if (inside && fitted?.scale) {
        const point = toCanvas(
          { x: e.clientX, y: e.clientY },
          root.current!.getBoundingClientRect(),
          fitted,
        );
        at = guideAt(
          point[d.axis],
          e.altKey ? [] : d.lines,
          SNAP_REACH / fitted.scale,
        );
      }
      if (at === d.at) return;
      d.at = at;
      setMoving({ axis: d.axis, index: d.index, at });
      return;
    }
    if (d.kind === "pan") {
      // The view follows the pointer, as if the canvas were held
      const pane = scroller.current!;
      pane.scrollLeft = d.left - (e.clientX - d.x);
      pane.scrollTop = d.top - (e.clientY - d.y);
      return;
    }
    if (d.kind === "rotate") {
      // Shift turns it in steps of 15 degrees
      const pointer = { x: e.clientX, y: e.clientY };
      const turned = turnTo(d.center, pointer, e.shiftKey);
      if (d.frame) {
        onGroupFrame(d.id, d.frame, { ...d.frame, rotation: turned });
      } else {
        onRotate(d.id, turned);
      }
      return;
    }
    // Alt drags freely: nothing sticks, and no rose lines
    const free = e.altKey;
    // Screen px to the canvas's
    const reach = SNAP_REACH / d.scale;
    const pointer = {
      x: (e.clientX - d.x) / d.scale,
      y: (e.clientY - d.y) / d.scale,
    };
    if (d.kind === "frame") {
      // Its elements scale with it, along its own sides
      const options = { rotation: d.frame.rotation, even: linked };
      const turned = (box: Box) => ({ ...box, rotation: d.frame.rotation });
      const resize = ({ x, y }: Point) =>
        turned(resizeBox(d.frame, d.corner, x, y, options));
      const move = free
        ? pointer
        : stickCorner(
            d.frame,
            resize(pointer),
            d.corner,
            pointer,
            d.lines,
            reach,
            linked,
          );
      const box = resize(move);
      showMet(free ? [] : metLines(box, d.lines));
      onGroupFrame(d.id, d.frame, box);
      return;
    }
    if (d.kind === "group") {
      const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DRAG_START;
      if (!d.moved && !far) return;
      d.moved = true;
      const moved = {
        ...d.frame,
        x: d.frame.x + pointer.x,
        y: d.frame.y + pointer.y,
      };
      const by = free ? { x: 0, y: 0 } : snapBox(moved, d.lines, reach);
      // Rounded once for all of them, so they keep their spacing
      const dx = Math.round(pointer.x + by.x);
      const dy = Math.round(pointer.y + by.y);
      showMet(
        free
          ? []
          : metLines(
              { ...d.frame, x: d.frame.x + dx, y: d.frame.y + dy },
              d.lines,
            ),
      );
      if (dx === d.sent[0] && dy === d.sent[1]) return;
      onShift(d.id, dx - d.sent[0], dy - d.sent[1]);
      d.sent = [dx, dy];
      return;
    }
    let box: Box;
    const { corner } = d;
    if (corner) {
      // A text's box can't get narrower than its longest word, nor shorter
      // than its words
      const options = {
        minWidth: textWidth(d.id, d.scale),
        minHeight: (width: number) => textHeight(d.id, width, d.scale),
        rotation: d.rotation,
        even: linked,
      };
      const resize = ({ x, y }: Point) =>
        resizeBox(d.box, corner, x, y, options);
      const move = free
        ? pointer
        : stickCorner(
            { ...d.box, rotation: d.rotation },
            { ...resize(pointer), rotation: d.rotation },
            corner,
            pointer,
            d.lines,
            reach,
            linked,
          );
      box = roundBox(resize(move));
    } else {
      const moved = {
        ...d.box,
        x: d.box.x + pointer.x,
        y: d.box.y + pointer.y,
      };
      const by = free
        ? { x: 0, y: 0 }
        : snapBox({ ...moved, rotation: d.rotation }, d.lines, reach);
      box = roundBox({ ...moved, x: moved.x + by.x, y: moved.y + by.y });
    }
    showMet(free ? [] : metLines({ ...box, rotation: d.rotation }, d.lines));
    onBox(d.id, box);
  };

  const onPointerUp = () => {
    const d = drag.current;
    end();
    if (d?.kind === "group" && !d.moved) {
      onSelect(pickElement(view, locked, d.point));
    }
    // Saved once, where it was let go: nothing for one that didn't move
    if (d?.kind === "guide") {
      const was = d.index === null ? null : guides[d.axis][d.index];
      if (d.at !== was) onGuides(withGuide(guides, d.axis, d.index, d.at));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!selected) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onSelect(null);
      return;
    }
    // Backspace too, a Mac's delete key. Not a locked one, as the arrows
    // leave it: the list's Delete and the trash still take it.
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!stuck) onDelete(selected);
      return;
    }
    const nudge = NUDGES[e.key];
    if (!nudge || !frame) return;
    e.preventDefault();
    if (stuck) return;
    const step = e.shiftKey ? 10 : 1;
    if (chosenGroup) {
      onShift(chosenGroup.id, nudge[0] * step, nudge[1] * step);
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

  const outline: CSSProperties | undefined = frame
    ? {
        left: fit.left + frame.x * fit.scale,
        top: fit.top + frame.y * fit.scale,
        width: frame.width * fit.scale,
        height: frame.height * fit.scale,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
      }
    : undefined;

  const zoomOut = zoomStep(level, -1);
  const zoomIn = zoomStep(level, 1);

  // The guides as they show, the dragged one where it is, in the area's px
  const shown = moving
    ? withGuide(guides, moving.axis, moving.index, moving.at)
    : guides;
  const across = (at: number) => Math.round(fit.left + at * fit.scale);
  const down = (at: number) => Math.round(fit.top + at * fit.scale);
  // A rose line: across the view along a guide, else along what it meets
  const metStyle = ({ axis, at, from, to }: MetLine): CSSProperties => {
    const whole = !Number.isFinite(from);
    if (axis === "x") {
      return whole
        ? { left: across(at) }
        : {
            left: across(at),
            top: down(from),
            height: (to - from) * fit.scale,
          };
    }
    return whole
      ? { top: down(at) }
      : { top: down(at), left: across(from), width: (to - from) * fit.scale };
  };

  return (
    <>
      <div className={cx(styles.stage_frame, rulers && styles.with_rulers)}>
        {rulers && (
          <Rulers
            scroller={scroller}
            root={root}
            fit={fit}
            onGuide={(e, axis) => startGuide(e, axis, null)}
            mark={
              moving?.at != null ? { axis: moving.axis, at: moving.at } : null
            }
          />
        )}
        <div
          ref={stageEl}
          className={cx(styles.stage, space && styles.spaced)}
          tabIndex={0}
          aria-label={t("studio.editor.canvas")}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Escape Delete Backspace Space Control+C Control+X Control+V"
          style={{
            // Hairlines drawn inside the scaled canvas stay one screen px
            "--canvas-scale": fit.scale || 1,
            cursor:
              held === "rotate"
                ? rotateCursor(rotation)
                : held
                  ? CURSORS[held]
                  : space
                    ? "grab"
                    : over
                      ? CURSORS[over]
                      : undefined,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onPointerLeave={() => setOver(null)}
          onKeyDown={onKeyDown}
        >
          <div ref={scroller} className={styles.stage_scroll}>
            <div className={styles.stage_sizer}>
              <div
                className={cx(
                  styles.stage_area,
                  zoom !== null && styles.zoomed,
                )}
                style={
                  zoom === null
                    ? undefined
                    : {
                        width: Math.round(view.width * zoom),
                        height: Math.round(view.height * zoom),
                      }
                }
              >
                <div ref={root} className={styles.stage_root} />
                {rulers &&
                  shown.x.map((at, i) => (
                    <span
                      key={`x${i}`}
                      className={styles.guide_x}
                      style={{ left: across(at) }}
                      data-guide="x"
                      aria-hidden
                    />
                  ))}
                {rulers &&
                  shown.y.map((at, i) => (
                    <span
                      key={`y${i}`}
                      className={styles.guide_y}
                      style={{ top: down(at) }}
                      data-guide="y"
                      aria-hidden
                    />
                  ))}
                {met.map((line) => (
                  <span
                    key={`${line.axis}${line.at}`}
                    className={cx(
                      line.axis === "x" ? styles.met_x : styles.met_y,
                      !Number.isFinite(line.from) && styles.met_whole,
                    )}
                    style={metStyle(line)}
                    data-met={line.axis}
                    aria-hidden
                  />
                ))}
                {outline && (
                  <div className={styles.selection} style={outline}>
                    {!stuck && (chosen || groupFrame) && (
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
                          // Along the circle it turns on, but the hand while
                          // Space is down
                          style={
                            space
                              ? undefined
                              : { cursor: rotateCursor(rotation) }
                          }
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {elements.map(({ element }) => {
            if (element.kind !== "overlay") return null;
            const slot = slots.get(element.id);
            return slot ? createPortal(embed(element), slot, element.id) : null;
          })}
        </div>
      </div>

      <div className={styles.canvas_bar}>
        {children}
        <div className={styles.zoom}>
          <Btn
            variant="icon"
            title={t("studio.editor.rulers")}
            aria-label={t("studio.editor.rulers")}
            aria-keyshortcuts="Control+R"
            aria-pressed={rulers}
            active={rulers}
            onClick={() => onRulers(!rulers)}
          >
            <LuRuler size={16} />
          </Btn>
          <Btn
            variant="icon"
            title={t("studio.editor.zoomOut")}
            aria-label={t("studio.editor.zoomOut")}
            aria-keyshortcuts="Control+-"
            disabled={zoomOut === null}
            onClick={() => stepZoom(-1)}
          >
            <LuZoomOut size={16} />
          </Btn>
          <output
            className={styles.zoom_level}
            aria-label={t("studio.editor.zoom")}
          >
            {percent.format(level)}
          </output>
          <Btn
            variant="icon"
            title={t("studio.editor.zoomIn")}
            aria-label={t("studio.editor.zoomIn")}
            aria-keyshortcuts="Control+="
            disabled={zoomIn === null}
            onClick={() => stepZoom(1)}
          >
            <LuZoomIn size={16} />
          </Btn>
          <Btn
            variant="icon"
            title={t("studio.editor.zoomFit")}
            aria-label={t("studio.editor.zoomFit")}
            aria-keyshortcuts="Control+0"
            onClick={() => zoomTo(null)}
          >
            <LuMaximize size={16} />
          </Btn>
        </div>
      </div>
    </>
  );
}
