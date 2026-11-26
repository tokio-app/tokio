import { STUDIO_MAX_FONT_SIZE, StudioElementOf } from "@/common/schemas";
import { Color, Field, FontSelect, NumberInput } from "@/components";
import { useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

type Face = Pick<StudioElementOf<"text">, "font" | "size" | "color">;

type Props<E extends Face> = {
  element: E;
  onChange: (element: E) => void;
};

/** A text's font, then its size and color, for the elements that draw text. */
export function FontFields<E extends Face>({ element, onChange }: Props<E>) {
  const t = useT();
  return (
    <>
      <Field label={t("studio.fields.font")}>
        <FontSelect
          value={element.font}
          defaultLabel={t("common.defaultFont")}
          onChange={(font) => onChange({ ...element, font })}
        />
      </Field>
      <div className={styles.pair}>
        <Field label={t("studio.fields.size")}>
          <NumberInput
            scrub
            min={1}
            max={STUDIO_MAX_FONT_SIZE}
            value={element.size}
            onChange={(size) => onChange({ ...element, size })}
          />
        </Field>
        <Field label={t("studio.fields.color")}>
          <Color
            value={element.color}
            onChange={(color) => onChange({ ...element, color })}
          />
        </Field>
      </div>
    </>
  );
}
