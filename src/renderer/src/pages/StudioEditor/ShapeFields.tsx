import {
  STUDIO_MAX_CORNERS,
  STUDIO_SHAPES,
  StudioElementOf,
  StudioShape,
} from "@/common/schemas";
import { Field, NumberInput } from "@/components";
import { useT } from "@/ui/i18n";
import { IconType } from "react-icons";
import {
  LuArrowBigRight,
  LuCircle,
  LuHeart,
  LuMessageSquare,
  LuRectangleHorizontal,
  LuStar,
  LuTriangle,
} from "react-icons/lu";
import styles from "./studioeditor.module.css";

type Shape = StudioElementOf<"shape">;

const ICONS: Record<StudioShape, IconType> = {
  rectangle: LuRectangleHorizontal,
  ellipse: LuCircle,
  polygon: LuTriangle,
  star: LuStar,
  arrow: LuArrowBigRight,
  heart: LuHeart,
  bubble: LuMessageSquare,
};

type Props = {
  element: Shape;
  onChange: (element: Shape) => void;
};

/**
 * A shape's picker, a tile per shape, and the one number its shape takes: a
 * polygon's sides, a star's points, or a rectangle's or speech bubble's
 * corner radius.
 */
export function ShapeFields({ element, onChange }: Props) {
  const t = useT();
  const { shape } = element;

  return (
    <>
      <Field label={t("studio.fields.shape")}>
        {/* Native radios, so the arrow keys move through the shapes */}
        <div className={styles.shapes}>
          {STUDIO_SHAPES.map((option) => {
            const Icon = ICONS[option];
            const name = t(`studio.shapes.${option}`);
            return (
              <label key={option} className={styles.shape_tile} title={name}>
                <input
                  type="radio"
                  name={`studio-shape-${element.id}`}
                  className={styles.shape_input}
                  aria-label={name}
                  checked={shape === option}
                  onChange={() => onChange({ ...element, shape: option })}
                />
                <Icon size={18} aria-hidden />
              </label>
            );
          })}
        </div>
      </Field>
      {shape === "polygon" && (
        <Field label={t("studio.fields.sides")}>
          <NumberInput
            scrub
            integer
            min={3}
            max={STUDIO_MAX_CORNERS}
            value={element.sides}
            onChange={(sides) => onChange({ ...element, sides })}
          />
        </Field>
      )}
      {shape === "star" && (
        <Field label={t("studio.fields.points")}>
          <NumberInput
            scrub
            integer
            min={3}
            max={STUDIO_MAX_CORNERS}
            value={element.points}
            onChange={(points) => onChange({ ...element, points })}
          />
        </Field>
      )}
      {(shape === "rectangle" || shape === "bubble") && (
        <Field label={t("studio.fields.radius")}>
          <NumberInput
            scrub
            min={0}
            value={element.radius}
            onChange={(radius) => onChange({ ...element, radius })}
          />
        </Field>
      )}
    </>
  );
}
