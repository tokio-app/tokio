import { MessageKey } from "@/common/i18n";
import { Btn, Field, NumberInput, Slider } from "@/components";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { ReactNode, useRef } from "react";
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
  LuLink2,
} from "react-icons/lu";
import { AlignTo, Box, Turned, Words } from "./helper";
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
type Size = Pick<Box, "width" | "height">;

// Within a px: a group's frame comes back from its elements' whole px
const near = (a: Size, b: Size) =>
  Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;

type Props = {
  // An element's box, or a group's frame, in whole px and degrees
  box: Turned;
  flips: Record<Flip, boolean>;
  opacity: number;
  // The width and the height change together, in proportion
  linked: boolean;
  onLinked: (linked: boolean) => void;
  // A text's: its box stays as wide as its longest word and as tall as its
  // words, as on the canvas
  words?: Words;
  onBox: (box: Turned) => void;
  onFlip: (key: Flip) => void;
  onAlign: (to: AlignTo) => void;
  onOpacity: (opacity: number) => void;
};

/**
 * An element's or a group's position and size, turn, flips and opacity, and
 * the buttons that line it up with the canvas. Its numbers drag.
 */
export function BoxFields({
  box,
  flips,
  opacity,
  linked,
  onLinked,
  words,
  onBox,
  onFlip,
  onAlign,
  onOpacity,
}: Props) {
  const t = useT();
  // The size a run of changes to one field began from, and the last size it
  // made: the next change goes on from the first, so rounding doesn't add up
  // in proportion, and the height a narrower width gave a text comes back
  // with a wider one. Another field, or a size the fields didn't make (a
  // drag, another element), starts over.
  const sizing = useRef<{ key: keyof Size; from: Size; made: Size } | null>(
    null,
  );
  const resized = (key: keyof Size, value: number): Size => {
    const last = sizing.current;
    const from = last?.key === key && near(last.made, box) ? last.from : box;
    const ratio = from.width / from.height;
    let width =
      key === "width" ? value : linked ? Math.round(value * ratio) : box.width;
    let height =
      key === "height"
        ? value
        : linked
          ? Math.round(value / ratio)
          : from.height;
    if (words) {
      width = Math.max(width, words.width);
      height = Math.max(height, words.heightAt(width));
    }
    const made = { width: Math.max(1, width), height: Math.max(1, height) };
    sizing.current = {
      key,
      from: { width: from.width, height: from.height },
      made,
    };
    return made;
  };

  const field = (
    key: keyof Turned,
    label: MessageKey,
    min?: number,
    max?: number,
    className?: string,
  ) => (
    <Field label={t(label)} className={className}>
      <NumberInput
        className={styles.number}
        integer
        scrub
        min={min}
        max={max}
        value={box[key]}
        onChange={(value) => {
          const { x, y, width, height, rotation } = box;
          const next = { x, y, width, height, rotation, [key]: value };
          onBox(
            key === "width" || key === "height"
              ? { ...next, ...resized(key, value) }
              : next,
          );
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
          {field("width", "studio.fields.width", words?.width ?? 1)}
          {/* Between the two it links */}
          <div className={cx(styles.icon_buttons, styles.link)}>
            <Btn
              variant="icon"
              title={t("studio.fields.linkSize")}
              aria-label={t("studio.fields.linkSize")}
              aria-pressed={linked}
              active={linked}
              onClick={() => {
                sizing.current = null;
                onLinked(!linked);
              }}
            >
              <LuLink2 size={16} />
            </Btn>
          </div>
          {field("height", "studio.fields.height", words?.height ?? 1)}
          {/* On its own row, in degrees as the handle turns it */}
          {field(
            "rotation",
            "studio.fields.rotation",
            -180,
            180,
            styles.rotation,
          )}
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
