import { StudioElementOf } from "@/common/schemas";
import { Check, Color, NumberInput } from "@/components";
import { useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

// What a text and a shape share of a gradient
type Gradient = Pick<
  StudioElementOf<"text" | "shape">,
  "gradient" | "gradient_color" | "gradient_angle"
>;

type Props<G extends Gradient> = {
  value: G;
  onChange: (value: G) => void;
};

/**
 * A text's or a shape's gradient, a paint row: on or off, then the color its
 * own fades into and the angle, as CSS turns it.
 */
export function GradientFields<G extends Gradient>({
  value,
  onChange,
}: Props<G>) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("studio.fields.gradient")}
      className={styles.paint_row}
    >
      <Check
        label={t("studio.fields.gradient")}
        checked={value.gradient}
        onChange={(e) => onChange({ ...value, gradient: e.target.checked })}
      />
      {value.gradient && (
        <>
          <Color
            value={value.gradient_color}
            onChange={(gradient_color) =>
              onChange({ ...value, gradient_color })
            }
          />
          <NumberInput
            className={styles.number}
            scrub
            aria-label={t("studio.fields.gradientAngle")}
            integer
            min={0}
            max={360}
            value={value.gradient_angle}
            onChange={(gradient_angle) =>
              onChange({ ...value, gradient_angle })
            }
          />
        </>
      )}
    </div>
  );
}
