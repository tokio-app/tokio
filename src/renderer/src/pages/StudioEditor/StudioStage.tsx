// The stream's own stylesheet, global as on its page, like the games
// overlay's preview: the canvas can't drift from what's on stream
import "@/common/studio/overlay.css";
import { createStage, Stage, StageFit } from "@/common/studio/stage";
import { StudioLayerView, StudioView } from "@/common/types";
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
import { Box, roundBox } from "./helper";
import styles from "./studioeditor.module.css";

export type EmbedView = Extract<StudioLayerView, { kind: "overlay" }>;

declare module "react" {
  interface CSSProperties {
    "--canvas-scale"?: number;
  }
}

type Props = {
  view: StudioView;
  // The stage, for Test to play its layers
  stageRef: RefObject<Stage | null>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  // A layer moved or resized, rounded to whole px
  onBox: (id: string, box: Box) => void;
  // An embed's preview, portaled into its slot
  embed: (layer: EmbedView) => ReactNode;
};

type Drag = {
  id: string;
  resize: boolean;
  // Where the pointer went down, and the box then
  x: number;
  y: number;
  box: Box;
  scale: number;
};

const NO_FIT: StageFit = { scale: 0, left: 0, top: 0 };

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
 * and the arrows. Embeds are React's previews, portaled into the stage's
 * slots, which stay put so iframes don't reload.
 */
export function StudioStage({
  view,
  stageRef,
  selected,
  onSelect,
  onBox,
  embed,
}: Props) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(NO_FIT);
  // Each embed's slot, which exists only once the stage drew its layer
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

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.update(view);
    setFit((last) => (sameFit(last, stage.fit()) ? last : stage.fit()));
    setSlots((last) => {
      const next = new Map<string, HTMLElement>();
      for (const layer of view.layers) {
        const slot = layer.kind === "overlay" && stage.slot(layer.id);
        if (slot) next.set(layer.id, slot);
      }
      const same =
        next.size === last.size &&
        [...next].every(([id, slot]) => last.get(id) === slot);
      return same ? last : next;
    });
  }, [view, stageRef]);

  const chosen = view.layers.find((layer) => layer.id === selected);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const resize = !!target.closest("[data-handle]");
    // Previews ignore the pointer, so it lands on their layer's element
    const id = resize
      ? (chosen?.id ?? null)
      : (target.closest<HTMLElement>("[data-layer]")?.dataset.layer ?? null);
    const layer = view.layers.find((l) => l.id === id);
    onSelect(layer?.id ?? null);
    // The keys go on from where it was clicked
    e.currentTarget.focus();
    e.preventDefault();
    const scale = stageRef.current?.fit().scale ?? 0;
    if (!layer || !scale) return;
    drag.current = {
      id: layer.id,
      resize,
      x: e.clientX,
      y: e.clientY,
      box: boxOf(layer),
      scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Screen px to the canvas's
    const dx = (e.clientX - d.x) / d.scale;
    const dy = (e.clientY - d.y) / d.scale;
    onBox(
      d.id,
      roundBox(
        d.resize
          ? { ...d.box, width: d.box.width + dx, height: d.box.height + dy }
          : { ...d.box, x: d.box.x + dx, y: d.box.y + dy },
      ),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!chosen) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onSelect(null);
      return;
    }
    const nudge = NUDGES[e.key];
    if (!nudge) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    onBox(
      chosen.id,
      roundBox({
        ...boxOf(chosen),
        x: chosen.x + nudge[0] * step,
        y: chosen.y + nudge[1] * step,
      }),
    );
  };

  const outline: CSSProperties | undefined = chosen && {
    left: fit.left + chosen.x * fit.scale,
    top: fit.top + chosen.y * fit.scale,
    width: chosen.width * fit.scale,
    height: chosen.height * fit.scale,
  };

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
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
    >
      <div ref={root} className={styles.stage_root} />
      {outline && (
        <div className={styles.selection} style={outline}>
          <span
            className={styles.handle}
            data-handle
            title={t("studio.editor.resize")}
          />
        </div>
      )}
      {view.layers.map((layer) => {
        if (layer.kind !== "overlay") return null;
        const slot = slots.get(layer.id);
        return slot ? createPortal(embed(layer), slot, layer.id) : null;
      })}
    </div>
  );
}
