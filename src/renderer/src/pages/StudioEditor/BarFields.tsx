import { StudioCounter, StudioElementOf } from "@/common/schemas";
import { Check, Color, Field, NumberInput, Select, Slider } from "@/components";
import { useT } from "@/ui/i18n";
import { GradientFields } from "./GradientFields";
import { goalNumbers } from "./helper";
import styles from "./studioeditor.module.css";

type Bar = StudioElementOf<"bar">;

type Props = {
  element: Bar;
  // The overlay's counters, which a bar can fill toward its goal too
  counters: StudioCounter[];
  onChange: (element: Bar) => void;
};

/**
 * A goal bar's own fields: the number it watches and its goal, the fill's
 * color and gradient, the track's color, its corners, and which way it
 * fills. Turning it vertical turns its box too, around its center.
 */
export function BarFields({ element, counters, onChange }: Props) {
  const t = useT();
  const corners = t("studio.fields.rounding", {
    rounding: String(element.rounding),
  });

  // A 720 × 56 bar becomes 56 × 720 where it was, in one step
  const turn = (vertical: boolean) => {
    const { x, y, width, height } = element;
    onChange({
      ...element,
      vertical,
      x: x + Math.round((width - height) / 2),
      y: y + Math.round((height - width) / 2),
      width: height,
      height: width,
    });
  };

  return (
    <>
      <Field label={t("studio.goal.number")}>
        {/* A counter since removed shows none, as a goal row does */}
        <Select
          options={goalNumbers(counters)}
          value={element.number}
          onChange={(number) => onChange({ ...element, number })}
        />
      </Field>
      <Field label={t("studio.goal.goal")}>
        <NumberInput
          scrub
          integer
          min={1}
          value={element.goal}
          onChange={(goal) => onChange({ ...element, goal })}
        />
      </Field>
      <div className={styles.paint}>
        <Field label={t("studio.fields.fill")}>
          <Color
            value={element.color}
            onChange={(color) => onChange({ ...element, color })}
          />
        </Field>
        <GradientFields value={element} onChange={onChange} />
        <Field label={t("studio.fields.track")}>
          <Color
            value={element.track}
            onChange={(track) => onChange({ ...element, track })}
          />
        </Field>
      </div>
      <Field label={corners}>
        <Slider
          aria-label={corners}
          min={0}
          max={50}
          value={element.rounding}
          onChange={(rounding) => onChange({ ...element, rounding })}
        />
      </Field>
      <Check
        label={t("studio.fields.vertical")}
        checked={element.vertical}
        onChange={(e) => turn(e.target.checked)}
      />
    </>
  );
}
