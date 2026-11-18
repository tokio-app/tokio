import {
  STUDIO_MAX_BLUR,
  STUDIO_MAX_SHADOW_BLUR,
  STUDIO_MAX_SHADOW_OFFSET,
  StudioElement,
} from "@/common/schemas";
import { Check, Color, Field, NumberInput } from "@/components";
import { MessageKey } from "@/common/i18n";
import { useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

type Props<E extends StudioElement> = {
  element: E;
  onChange: (element: E) => void;
};

/**
 * Any element's shadow, a paint row with its softness and offset under it
 * once on (a glow is one with no offset), and its blur.
 */
export function EffectsFields<E extends StudioElement>({
  element,
  onChange,
}: Props<E>) {
  const t = useT();
  const number = (
    key: "shadow_blur" | "shadow_x" | "shadow_y" | "blur",
    label: MessageKey,
    min: number,
    max: number,
  ) => (
    <Field label={t(label)}>
      <NumberInput
        className={styles.number}
        scrub
        aria-label={t(label)}
        integer
        min={min}
        max={max}
        value={element[key]}
        onChange={(value) => onChange({ ...element, [key]: value })}
      />
    </Field>
  );

  return (
    <>
      <div
        role="group"
        aria-label={t("studio.fields.shadow")}
        className={styles.paint}
      >
        <div className={styles.paint_row}>
          <Check
            label={t("studio.fields.shadow")}
            checked={element.shadow}
            onChange={(e) => onChange({ ...element, shadow: e.target.checked })}
          />
          {element.shadow && (
            <Color
              value={element.shadow_color}
              onChange={(shadow_color) =>
                onChange({ ...element, shadow_color })
              }
            />
          )}
        </div>
        {element.shadow && (
          <div className={styles.effects}>
            {number(
              "shadow_blur",
              "studio.fields.softness",
              0,
              STUDIO_MAX_SHADOW_BLUR,
            )}
            {number(
              "shadow_x",
              "studio.fields.x",
              -STUDIO_MAX_SHADOW_OFFSET,
              STUDIO_MAX_SHADOW_OFFSET,
            )}
            {number(
              "shadow_y",
              "studio.fields.y",
              -STUDIO_MAX_SHADOW_OFFSET,
              STUDIO_MAX_SHADOW_OFFSET,
            )}
          </div>
        )}
      </div>
      <div className={styles.effects}>
        {number("blur", "studio.fields.blur", 0, STUDIO_MAX_BLUR)}
      </div>
    </>
  );
}
