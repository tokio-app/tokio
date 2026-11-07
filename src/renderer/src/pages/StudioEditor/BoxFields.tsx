import { MessageKey } from "@/common/i18n";
import { Btn, Field, NumberInput, Slider } from "@/components";
import { useT } from "@/ui/i18n";
import { ReactNode } from "react";
import { IconType } from "react-icons";
import {
  LuAlignCenterHorizontal,
  LuAlignCenterVertical,
  LuAlignEndHorizontal,
  LuAlignEndVertical,
  LuAlignStartHorizontal,
  LuAlignStartVertical,
  LuFlipHorizontal2,
  LuFlipVertical2,
} from "react-icons/lu";
import { AlignTo, Turned } from "./helper";
import styles from "./studioeditor.module.css";

// The canvas's edges and middles, across then down
const ALIGNS_TO: { to: AlignTo; label: MessageKey; Icon: IconType }[][] = [
  [
    { to: "left", label: "studio.alignTo.left", Icon: LuAlignStartVertical },
    {
      to: "center",
      label: "studio.alignTo.center",
      Icon: LuAlignCenterVertical,
    },
    { to: "right", label: "studio.alignTo.right", Icon: LuAlignEndVertical },
  ],
  [
    { to: "top", label: "studio.alignTo.top", Icon: LuAlignStartHorizontal },
    {
      to: "middle",
      label: "studio.alignTo.middle",
      Icon: LuAlignCenterHorizontal,
    },
    {
      to: "bottom",
      label: "studio.alignTo.bottom",
      Icon: LuAlignEndHorizontal,
    },
  ],
];

type Flip = "flip_x" | "flip_y";

type Props = {
  // An element's box, or a group's frame, in whole px and degrees
  box: Turned;
  flips: Record<Flip, boolean>;
  opacity: number;
  onBox: (box: Turned) => void;
  onFlip: (key: Flip) => void;
  onAlign: (to: AlignTo) => void;
  onOpacity: (opacity: number) => void;
};

/**
 * An element's or a group's position and size, turn, flips and opacity, and
 * the buttons that line it up with the canvas.
 */
export function BoxFields({
  box,
  flips,
  opacity,
  onBox,
  onFlip,
  onAlign,
  onOpacity,
}: Props) {
  const t = useT();

  const field = (
    key: keyof Turned,
    label: MessageKey,
    min?: number,
    max?: number,
  ) => (
    <Field label={t(label)}>
      <NumberInput
        className={styles.number}
        integer
        min={min}
        max={max}
        value={box[key]}
        onChange={(value) => {
          const { x, y, width, height, rotation } = box;
          onBox({ x, y, width, height, rotation, [key]: value });
        }}
      />
    </Field>
  );

  const flip = (key: Flip, label: MessageKey, icon: ReactNode) => (
    <Btn
      variant="icon"
      title={t(label)}
      aria-label={t(label)}
      aria-pressed={flips[key]}
      active={flips[key]}
      onClick={() => onFlip(key)}
    >
      {icon}
    </Btn>
  );

  const percent = Math.round(opacity * 100);

  return (
    <>
      <Field label={t("studio.fields.box")}>
        <div className={styles.box}>
          {field("x", "studio.fields.x")}
          {field("y", "studio.fields.y")}
          {field("width", "studio.fields.width", 1)}
          {field("height", "studio.fields.height", 1)}
          {/* On its own row, in degrees as the handle turns it */}
          {field("rotation", "studio.fields.rotation", -180, 180)}
          <Field label={t("studio.fields.flip")} className={styles.flips}>
            <div className={styles.icon_buttons}>
              {flip(
                "flip_x",
                "studio.fields.flipX",
                <LuFlipHorizontal2 size={16} />,
              )}
              {flip(
                "flip_y",
                "studio.fields.flipY",
                <LuFlipVertical2 size={16} />,
              )}
            </div>
          </Field>
          <Field label={t("studio.fields.alignTo")} className={styles.align_to}>
            <div className={styles.icon_groups}>
              {ALIGNS_TO.map((group) => (
                <div key={group[0].to} className={styles.icon_buttons}>
                  {group.map(({ to, label, Icon }) => (
                    <Btn
                      key={to}
                      variant="icon"
                      title={t(label)}
                      aria-label={t(label)}
                      onClick={() => onAlign(to)}
                    >
                      <Icon size={16} />
                    </Btn>
                  ))}
                </div>
              ))}
            </div>
          </Field>
        </div>
      </Field>
      <Field label={t("studio.fields.opacity", { opacity: String(percent) })}>
        <Slider
          aria-label={t("studio.fields.opacity", { opacity: String(percent) })}
          min={0}
          max={100}
          value={percent}
          onChange={(value) => onOpacity(value / 100)}
        />
      </Field>
    </>
  );
}
