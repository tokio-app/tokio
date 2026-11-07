import { MessageKey } from "@/common/i18n";
import {
  STUDIO_MAX_GUIDES,
  STUDIO_NAME_MAX_LENGTH,
  STUDIO_SIZES,
  StudioGuides,
  StudioOverlay,
} from "@/common/schemas";
import { getStudioOverlayURL } from "@/common/util";
import {
  Btn,
  CopyField,
  Field,
  Input,
  NumberInput,
  RadioGroup,
} from "@/components";
import { sizeText } from "@/pages/Studio/helper";
import { useT } from "@/ui/i18n";
import { useId } from "react";
import { IconType } from "react-icons";
import { FiLock, FiTrash2, FiUnlock, FiX } from "react-icons/fi";
import { LuSeparatorHorizontal, LuSeparatorVertical } from "react-icons/lu";
import { Axis, AXES, withGuide } from "./helper";
import styles from "./studioeditor.module.css";

type Props = {
  overlay: StudioOverlay;
  onChange: (overlay: StudioOverlay) => void;
};

/**
 * With nothing selected: the overlay's name, canvas and URL, and its guides
 * while the rulers show them.
 */
export function OverlaySettings({ overlay, onChange }: Props) {
  const t = useT();
  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t("studio.settings.title")}</h3>
      <Field label={t("common.name")}>
        <Input
          maxLength={STUDIO_NAME_MAX_LENGTH}
          placeholder={t("studio.untitled")}
          value={overlay.name}
          onChange={(e) => onChange({ ...overlay, name: e.target.value })}
        />
      </Field>
      <Field label={t("studio.settings.canvas")}>
        <RadioGroup
          name="studio-size"
          value={overlay.size}
          options={[
            {
              value: "portrait",
              label: t("studio.settings.portrait"),
              description: sizeText("portrait"),
            },
            {
              value: "landscape",
              label: t("studio.settings.landscape"),
              description: sizeText("landscape"),
            },
          ]}
          onChange={(size) => onChange({ ...overlay, size })}
        />
      </Field>
      <Field label={t("common.overlayUrl")}>
        <CopyField
          value={getStudioOverlayURL(overlay.id)}
          title={t("studio.copyUrl")}
        />
      </Field>
      {overlay.rulers && (
        <Guides
          guides={overlay.guides}
          canvas={STUDIO_SIZES[overlay.size]}
          onChange={(guides) => onChange({ ...overlay, guides })}
        />
      )}
    </div>
  );
}

// Each axis's letter as the box fields name it, its rows' names, and its
// add button
const AXIS_TEXT: Record<
  Axis,
  {
    letter: MessageKey;
    row: MessageKey;
    remove: MessageKey;
    add: MessageKey;
    Icon: IconType;
  }
> = {
  x: {
    letter: "studio.fields.x",
    row: "studio.guides.vertical",
    remove: "studio.guides.removeVertical",
    add: "studio.guides.addVertical",
    Icon: LuSeparatorVertical,
  },
  y: {
    letter: "studio.fields.y",
    row: "studio.guides.horizontal",
    remove: "studio.guides.removeHorizontal",
    add: "studio.guides.addHorizontal",
    Icon: LuSeparatorHorizontal,
  },
};

/**
 * The overlay's guides, vertical then horizontal, each where it is in a
 * number field: added at the canvas's middle, locked, or all removed. Lock
 * holds only the canvas back, as an element's does.
 */
function Guides({
  guides,
  canvas,
  onChange,
}: {
  guides: StudioGuides;
  canvas: { width: number; height: number };
  onChange: (guides: StudioGuides) => void;
}) {
  const t = useT();
  const title = useId();
  const none = guides.x.length + guides.y.length === 0;
  const lock = t("studio.guides.lock");
  const removeAll = t("studio.guides.removeAll");
  const middle = { x: canvas.width / 2, y: canvas.height / 2 };

  return (
    <div className={styles.guides} role="group" aria-labelledby={title}>
      <div className={styles.guides_head}>
        <span id={title} className={styles.guides_title}>
          {t("studio.guides.title")}
        </span>
        <div className={styles.icon_buttons}>
          <Btn
            variant="icon"
            title={lock}
            aria-label={lock}
            aria-pressed={guides.locked}
            active={guides.locked}
            onClick={() => onChange({ ...guides, locked: !guides.locked })}
          >
            {guides.locked ? <FiLock size={16} /> : <FiUnlock size={16} />}
          </Btn>
          <Btn
            variant="icon"
            title={removeAll}
            aria-label={removeAll}
            disabled={none}
            onClick={() => onChange({ ...guides, x: [], y: [] })}
          >
            <FiTrash2 size={16} />
          </Btn>
        </div>
      </div>
      {none ? (
        <p className={styles.note}>{t("studio.guides.empty")}</p>
      ) : (
        <ul className={styles.guide_list}>
          {AXES.flatMap((axis) =>
            guides[axis].map((at, index) => {
              const { letter, row, remove } = AXIS_TEXT[axis];
              const number = String(index + 1);
              const removing = t(remove, { number });
              return (
                <li key={`${axis}${index}`} className={styles.guide_row}>
                  <span className={styles.guide_axis} aria-hidden>
                    {t(letter)}
                  </span>
                  <NumberInput
                    className={styles.number}
                    integer
                    scrub
                    aria-label={t(row, { number })}
                    value={at}
                    onChange={(value) =>
                      onChange(withGuide(guides, axis, index, value))
                    }
                  />
                  <Btn
                    variant="icon"
                    title={removing}
                    aria-label={removing}
                    onClick={() =>
                      onChange(withGuide(guides, axis, index, null))
                    }
                  >
                    <FiX size={16} />
                  </Btn>
                </li>
              );
            }),
          )}
        </ul>
      )}
      <div className={styles.guide_adds}>
        {AXES.map((axis) => {
          const { add, Icon } = AXIS_TEXT[axis];
          return (
            <Btn
              key={axis}
              disabled={guides[axis].length >= STUDIO_MAX_GUIDES}
              onClick={() =>
                onChange(withGuide(guides, axis, null, middle[axis]))
              }
            >
              <Icon size={16} aria-hidden />
              {t(add)}
            </Btn>
          );
        })}
      </div>
    </div>
  );
}
