import { MessageKey } from "@/common/i18n";
import { StudioCrop } from "@/common/schemas";
import { Btn, Field, NumberInput, Slider } from "@/components";
import { useT } from "@/ui/i18n";
import { useId } from "react";
import { LuCrop, LuRotateCcw } from "react-icons/lu";
import { WHOLE } from "./helper";
import styles from "./studioeditor.module.css";

// Each side a crop cuts from, as its field names it, and the one across
const SIDES: {
  side: keyof StudioCrop;
  across: keyof StudioCrop;
  label: MessageKey;
}[] = [
  { side: "left", across: "right", label: "studio.fields.cropLeft" },
  { side: "top", across: "bottom", label: "studio.fields.cropTop" },
  { side: "right", across: "left", label: "studio.fields.cropRight" },
  { side: "bottom", across: "top", label: "studio.fields.cropBottom" },
];

// A share as a %, to 2 decimals
const percent = (share: number) => Math.round(share * 10000) / 100;

type Props = {
  crop: StudioCrop;
  rounding: number;
  // Crops on the canvas, null for a viewer's picture, which only its fields
  // crop
  onCropCanvas: (() => void) | null;
  onCrop: (crop: StudioCrop) => void;
  onRounding: (rounding: number) => void;
};

/**
 * A picture's crop, the % it cuts from each side, with Crop to drag it on the
 * canvas and Reset to keep all of it, and how round its corners are.
 */
export function PictureFields({
  crop,
  rounding,
  onCropCanvas,
  onCrop,
  onRounding,
}: Props) {
  const t = useT();
  const title = useId();
  const cropped = crop.left || crop.top || crop.right || crop.bottom;
  const onCanvas = t("studio.fields.cropOnCanvas");
  const reset = t("studio.fields.cropReset");
  const corners = t("studio.fields.rounding", { rounding: String(rounding) });

  return (
    <>
      <div className={styles.titled} role="group" aria-labelledby={title}>
        <div className={styles.titled_head}>
          <span id={title} className={styles.titled_name}>
            {t("studio.fields.crop")}
          </span>
          <div className={styles.icon_buttons}>
            {onCropCanvas && (
              <Btn
                variant="icon"
                title={onCanvas}
                aria-label={onCanvas}
                onClick={onCropCanvas}
              >
                <LuCrop size={16} />
              </Btn>
            )}
            <Btn
              variant="icon"
              title={reset}
              aria-label={reset}
              disabled={!cropped}
              onClick={() => onCrop(WHOLE)}
            >
              <LuRotateCcw size={16} />
            </Btn>
          </div>
        </div>
        <div className={styles.crop}>
          {SIDES.map(({ side, across, label }) => (
            <Field key={side} label={t(label)}>
              <NumberInput
                className={styles.number}
                scrub
                min={0}
                // What the side across cuts leaves at least 1% of it
                max={99 - percent(crop[across])}
                value={percent(crop[side])}
                onChange={(value) =>
                  onCrop({ ...crop, [side]: Math.round(value * 100) / 10000 })
                }
              />
            </Field>
          ))}
        </div>
      </div>
      <Field label={corners}>
        <Slider
          aria-label={corners}
          min={0}
          max={50}
          value={rounding}
          onChange={onRounding}
        />
      </Field>
    </>
  );
}
