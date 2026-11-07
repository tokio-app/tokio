import { STUDIO_NAME_MAX_LENGTH, StudioGroup } from "@/common/schemas";
import { Field, Input } from "@/components";
import { useT } from "@/ui/i18n";
import { useRef } from "react";
import { BoxFields } from "./BoxFields";
import { AlignTo, Turned } from "./helper";
import styles from "./studioeditor.module.css";

type Props = {
  group: StudioGroup;
  // Around its elements as they show, null with none
  frame: Turned | null;
  // Its frame's width and height change together, in proportion
  linked: boolean;
  onLinked: (linked: boolean) => void;
  onChange: (group: StudioGroup) => void;
  // Moves, scales or turns its elements from one frame into another
  onFrame: (from: Turned, to: Turned) => void;
  onFlip: (key: "flip_x" | "flip_y") => void;
  onAlign: (to: AlignTo) => void;
};

// The same turn, within a px: a frame comes back from its elements' whole px
const near = (a: Turned, b: Turned) =>
  a.rotation === b.rotation &&
  (["x", "y", "width", "height"] as const).every(
    (key) => Math.abs(a[key] - b[key]) <= 1,
  );

/**
 * The selected group's name, how its elements move together, and its frame's
 * position, size, turn, flips and opacity, which its elements take.
 */
export function GroupSettings({
  group,
  frame,
  linked,
  onLinked,
  onChange,
  onFrame,
  onFlip,
  onAlign,
}: Props) {
  const t = useT();
  // The frame a run of changes in its fields began from, and the last one
  // they asked for: while its frame is still that one, each change goes from
  // the first, so its elements' rounding doesn't add up over a dragged field
  const run = useRef<{ from: Turned; asked: Turned } | null>(null);
  // What the fields show, in whole px
  const shown = frame && {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
    rotation: frame.rotation,
  };
  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t("studio.group.title")}</h3>
      <Field label={t("common.name")}>
        <Input
          maxLength={STUDIO_NAME_MAX_LENGTH}
          placeholder={t("studio.editor.untitledGroup")}
          value={group.name}
          onChange={(e) => onChange({ ...group, name: e.target.value })}
        />
      </Field>
      <p className={styles.note}>
        {t(
          group.hidden
            ? "studio.group.hidden"
            : group.locked
              ? "studio.group.locked"
              : "studio.group.move",
        )}
      </p>
      {frame && shown && (
        <BoxFields
          box={shown}
          flips={group}
          opacity={group.opacity}
          linked={linked}
          onLinked={onLinked}
          // The field that changed; the others keep the frame as it is
          onBox={(box) => {
            const to = {
              x: frame.x + box.x - shown.x,
              y: frame.y + box.y - shown.y,
              width: box.width === shown.width ? frame.width : box.width,
              height: box.height === shown.height ? frame.height : box.height,
              rotation: box.rotation,
            };
            const last = run.current;
            const from = last && near(last.asked, frame) ? last.from : frame;
            run.current = { from, asked: to };
            onFrame(from, to);
          }}
          onFlip={onFlip}
          onAlign={onAlign}
          onOpacity={(opacity) => onChange({ ...group, opacity })}
        />
      )}
    </div>
  );
}
