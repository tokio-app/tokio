import { STUDIO_NAME_MAX_LENGTH, StudioGroup } from "@/common/schemas";
import { Field, Input } from "@/components";
import { useT } from "@/ui/i18n";
import { BoxFields } from "./BoxFields";
import { AlignTo, Turned } from "./helper";
import styles from "./studioeditor.module.css";

type Props = {
  group: StudioGroup;
  // Around its elements as they show, null with none
  frame: Turned | null;
  onChange: (group: StudioGroup) => void;
  // Moves, scales or turns its elements into the new frame
  onFrame: (frame: Turned) => void;
  onFlip: (key: "flip_x" | "flip_y") => void;
  onAlign: (to: AlignTo) => void;
};

/**
 * The selected group's name, how its elements move together, and its frame's
 * position, size, turn, flips and opacity, which its elements take.
 */
export function GroupSettings({
  group,
  frame,
  onChange,
  onFrame,
  onFlip,
  onAlign,
}: Props) {
  const t = useT();
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
          // The field that changed; the others keep the frame as it is
          onBox={(box) =>
            onFrame({
              x: frame.x + box.x - shown.x,
              y: frame.y + box.y - shown.y,
              width: box.width === shown.width ? frame.width : box.width,
              height: box.height === shown.height ? frame.height : box.height,
              rotation: box.rotation,
            })
          }
          onFlip={onFlip}
          onAlign={onAlign}
          onOpacity={(opacity) => onChange({ ...group, opacity })}
        />
      )}
    </div>
  );
}
