import {
  STUDIO_LIST_SOURCES,
  STUDIO_MAX_FONT_SIZE,
  STUDIO_MAX_LIST_GAP,
  STUDIO_MAX_LIST_ROWS,
  StudioElementOf,
} from "@/common/schemas";
import {
  Check,
  Color,
  Field,
  FontSelect,
  NumberInput,
  Select,
} from "@/components";
import { useOptions, useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

const SOURCES = STUDIO_LIST_SOURCES.map((value) => ({
  value,
  label: `studio.list.sources.${value}` as const,
}));

type List = StudioElementOf<"list">;

type Props = {
  element: List;
  onChange: (element: List) => void;
};

/**
 * A list's source and how many rows it shows, its text and the values' color
 * (top gifters' coins, gifts' counts), and its pictures.
 */
export function ListFields({ element, onChange }: Props) {
  const t = useT();
  const sources = useOptions(SOURCES);
  const valued = element.source === "gifters" || element.source === "gifts";

  return (
    <>
      <Field label={t("studio.list.source")}>
        <Select
          aria-label={t("studio.list.source")}
          options={sources}
          value={element.source}
          onChange={(source) => onChange({ ...element, source })}
        />
      </Field>
      <div className={styles.pair}>
        <Field label={t("studio.list.rows")}>
          <NumberInput
            scrub
            integer
            min={1}
            max={STUDIO_MAX_LIST_ROWS}
            value={element.rows}
            onChange={(rows) => onChange({ ...element, rows })}
          />
        </Field>
        <Field label={t("studio.list.gap")}>
          <NumberInput
            scrub
            min={0}
            max={STUDIO_MAX_LIST_GAP}
            value={element.gap}
            onChange={(gap) => onChange({ ...element, gap })}
          />
        </Field>
      </div>
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
      {valued && (
        <Field label={t("studio.list.valueColor")}>
          <Color
            value={element.value_color}
            onChange={(value_color) => onChange({ ...element, value_color })}
          />
        </Field>
      )}
      <div className={styles.checks}>
        <Check
          label={t("studio.list.pictures")}
          checked={element.pictures}
          onChange={(e) => onChange({ ...element, pictures: e.target.checked })}
        />
      </div>
    </>
  );
}
