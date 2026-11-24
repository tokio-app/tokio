import {
  STUDIO_LIST_SOURCES,
  STUDIO_MAX_FONT_SIZE,
  STUDIO_MAX_LIST_GAP,
  STUDIO_MAX_LIST_ROWS,
  StudioElementOf,
  StudioListSource,
} from "@/common/schemas";
import {
  Check,
  Color,
  Field,
  FontSelect,
  NumberInput,
  Select,
} from "@/components";
import { AlertTrigger, PLATFORMS, TOKIO_EVENTS } from "@/common/types";
import { PLATFORM_LABELS, triggersFor } from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { useOptions, useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

const SOURCES = STUDIO_LIST_SOURCES.map((value) => ({
  value,
  label: `studio.list.sources.${value}` as const,
}));

type List = StudioElementOf<"list">;

// The event a source lists, when only some platforms send it
const NEEDS: Partial<Record<StudioListSource, AlertTrigger>> = {
  followers: TOKIO_EVENTS.FOLLOW,
  gifts: TOKIO_EVENTS.GIFT,
};

type Props = {
  element: List;
  onChange: (element: List) => void;
};

/**
 * A list's source (and whose top gifters, with another platform than
 * TikTok) and how many rows it
 * shows, its text and the values' color (top gifters' coins, gifts' counts),
 * and its pictures.
 */
export function ListFields({ element, onChange }: Props) {
  const t = useT();
  const platforms = usePlatforms();
  const sent = triggersFor(platforms);
  // Followers and gifts from the platforms that send them; a saved one stays
  const sources = useOptions(SOURCES).filter(({ value }) => {
    const needs = NEEDS[value];
    return !needs || sent.includes(needs) || value === element.source;
  });
  const valued = element.source === "gifters" || element.source === "gifts";
  // Only once there's a choice: TikTok's gifters otherwise, as before the
  // other platforms
  const pickPlatform =
    element.source === "gifters" &&
    (platforms.some((p) => p !== "tiktok") || element.platform !== "tiktok");

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
      {pickPlatform && (
        <Field label={t("studio.list.platform")}>
          <Select
            aria-label={t("studio.list.platform")}
            // The profile's, and one saved that it no longer uses. Each
            // ranks its gifters in its own currency.
            options={PLATFORMS.filter(
              (p) => platforms.includes(p) || p === element.platform,
            ).map((value) => ({ value, label: PLATFORM_LABELS[value] }))}
            value={element.platform}
            onChange={(platform) => onChange({ ...element, platform })}
          />
        </Field>
      )}
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
