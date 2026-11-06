import { MessageKey } from "@/common/i18n";
import {
  STUDIO_MAX_FONT_SIZE,
  STUDIO_MAX_SECONDS,
  STUDIO_TEXT_MAX_LENGTH,
  StudioAlign,
  StudioAnimation,
  StudioEntrance,
  StudioElement,
  StudioWhen,
} from "@/common/schemas";
import { CustomGift, TOKIO_EVENTS } from "@/common/types";
import { studioVariables } from "@/common/util";
import {
  Btn,
  Check,
  Color,
  EmoteOption,
  Field,
  FontSelect,
  GiftSelect,
  Input,
  NumberInput,
  RadioGroup,
  Select,
  SelectOption,
  Slider,
  TRIGGER_OPTIONS,
  TriggerFilter,
  VariableList,
} from "@/components";
import { rich, useOptions, useT } from "@/ui/i18n";
import { ReactNode, useRef } from "react";
import { KIND_NAMES, sourceOf, sourceValue } from "./helper";
import styles from "./studioeditor.module.css";

const WHENS: { value: StudioWhen; label: MessageKey }[] = [
  { value: "always", label: "studio.when.always" },
  { value: "event", label: "studio.when.event" },
  { value: "animate", label: "studio.when.animate" },
];

const ENTRANCES: { value: StudioEntrance; label: MessageKey }[] = [
  { value: "fade", label: "studio.entrances.fade" },
  { value: "pop", label: "studio.entrances.pop" },
  { value: "slide", label: "studio.entrances.slide" },
];

const ANIMATIONS: { value: StudioAnimation; label: MessageKey }[] = [
  { value: "bounce", label: "studio.animations.bounce" },
  { value: "shake", label: "studio.animations.shake" },
  { value: "pulse", label: "studio.animations.pulse" },
];

const ALIGNS: { value: StudioAlign; label: MessageKey }[] = [
  { value: "left", label: "studio.aligns.left" },
  { value: "center", label: "studio.aligns.center" },
  { value: "right", label: "studio.aligns.right" },
];

type Props = {
  element: StudioElement;
  onChange: (element: StudioElement) => void;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // What an overlay element can frame
  sources: SelectOption<string>[];
  // Opens the media library for a media element
  onPickMedia: () => void;
};

/** The selected element's own fields, its box and opacity, and its When. */
export function ElementSettings({
  element,
  onChange,
  gifts,
  emotes,
  sources,
  onPickMedia,
}: Props) {
  const t = useT();
  const textRef = useRef<HTMLInputElement>(null);
  const aligns = useOptions(ALIGNS);
  const allWhens = useOptions(WHENS);
  const entrances = useOptions(ENTRANCES);
  const animations = useOptions(ANIMATIONS);
  const triggers = useOptions(TRIGGER_OPTIONS);
  // A viewer's picture needs the viewer an event brings
  const whens =
    element.kind === "viewer"
      ? allWhens.filter((w) => w.value !== "always")
      : allWhens;
  const { trigger } = element;

  let own: ReactNode = null;
  switch (element.kind) {
    case "text":
      own = (
        <>
          <Field label={t("studio.fields.text")}>
            <Input
              ref={textRef}
              maxLength={STUDIO_TEXT_MAX_LENGTH}
              value={element.text}
              onChange={(e) => onChange({ ...element, text: e.target.value })}
            />
            <VariableList
              variables={studioVariables(element)}
              inputRef={textRef}
              value={element.text}
              onChange={(text) => onChange({ ...element, text })}
            />
          </Field>
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
          <Field label={t("studio.fields.align")} className={styles.inline}>
            <RadioGroup
              name={`studio-align-${element.id}`}
              value={element.align}
              options={aligns}
              onChange={(align) => onChange({ ...element, align })}
            />
          </Field>
          <div className={styles.checks}>
            <Check
              label={t("studio.fields.bold")}
              checked={element.bold}
              onChange={(e) => onChange({ ...element, bold: e.target.checked })}
            />
            <Check
              label={t("studio.fields.halo")}
              checked={element.halo}
              onChange={(e) => onChange({ ...element, halo: e.target.checked })}
            />
          </div>
        </>
      );
      break;
    case "media":
      own = (
        <Field label={t("studio.fields.file")}>
          <Btn className={styles.file} onClick={onPickMedia}>
            <span className={styles.file_name}>
              {element.file ? element.name : t("studio.fields.pickFile")}
            </span>
          </Btn>
        </Field>
      );
      break;
    case "gift":
      own = (
        <Field label={t("studio.fields.gift")}>
          <GiftSelect
            gifts={gifts}
            value={element.gift ?? undefined}
            onChange={(gift) => onChange({ ...element, gift })}
          />
        </Field>
      );
      break;
    case "emote":
      own = (
        <Field label={t("studio.fields.emote")}>
          {emotes.length === 0 ? (
            <p className={styles.note}>{t("studio.fields.noEmotes")}</p>
          ) : (
            <Select
              placeholder={t("studio.fields.pickEmote")}
              options={emotes}
              value={element.emote?.id}
              onChange={(id) => {
                const emote = emotes.find((e) => e.value === id);
                if (emote) {
                  onChange({ ...element, emote: { id, image: emote.img } });
                }
              }}
            />
          )}
        </Field>
      );
      break;
    case "shape":
      own = (
        <div className={styles.pair}>
          <Field label={t("studio.fields.color")}>
            <Color
              value={element.color}
              onChange={(color) => onChange({ ...element, color })}
            />
          </Field>
          <Field label={t("studio.fields.radius")}>
            <NumberInput
              min={0}
              value={element.radius}
              onChange={(radius) => onChange({ ...element, radius })}
            />
          </Field>
        </div>
      );
      break;
    case "overlay":
      own = (
        <Field label={t("studio.fields.overlay")}>
          <Select
            placeholder={t("studio.fields.pickOverlay")}
            options={sources}
            value={sourceValue(element.source)}
            onChange={(value) =>
              onChange({ ...element, source: sourceOf(value) })
            }
          />
        </Field>
      );
      break;
  }

  const box = (
    key: "x" | "y" | "width" | "height" | "rotation",
    label: MessageKey,
    min?: number,
    max?: number,
  ) => (
    <Field label={t(label)}>
      <NumberInput
        className={styles.number}
        integer
        min={min}
        max={max}
        value={element[key]}
        onChange={(value) => {
          const next = { ...element };
          next[key] = value;
          onChange(next);
        }}
      />
    </Field>
  );

  const opacity = Math.round(element.opacity * 100);

  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t(KIND_NAMES[element.kind])}</h3>
      {own}

      <Field label={t("studio.fields.box")}>
        <div className={styles.box}>
          {box("x", "studio.fields.x")}
          {box("y", "studio.fields.y")}
          {box("width", "studio.fields.width", 1)}
          {box("height", "studio.fields.height", 1)}
          {/* On its own row, in degrees as the handle turns it */}
          {box("rotation", "studio.fields.rotation", -180, 180)}
        </div>
      </Field>
      <Field label={t("studio.fields.opacity", { opacity: String(opacity) })}>
        <Slider
          aria-label={t("studio.fields.opacity", { opacity: String(opacity) })}
          min={0}
          max={100}
          value={opacity}
          onChange={(value) => onChange({ ...element, opacity: value / 100 })}
        />
      </Field>

      <Field label={t("studio.when.title")}>
        <RadioGroup
          name={`studio-when-${element.id}`}
          value={element.when}
          options={whens}
          onChange={(when) => onChange({ ...element, when })}
        />
      </Field>

      {element.when !== "always" && (
        <>
          <Field label={t("studio.fields.trigger")}>
            <Select
              aria-label={t("studio.fields.trigger")}
              options={triggers}
              value={trigger.type}
              onChange={(type) =>
                onChange({ ...element, trigger: { ...trigger, type } })
              }
            />
            {trigger.type === TOKIO_EVENTS.LIKE ? (
              // Counted as game actions count them, from all viewers
              <span className={styles.likes}>
                {rich(t("studio.fields.likesEvery"), {
                  likes: (
                    <NumberInput
                      className={styles.number}
                      aria-label={t("studio.fields.likesPerReaction")}
                      integer
                      min={1}
                      value={element.likes_every}
                      onChange={(likes_every) =>
                        onChange({ ...element, likes_every })
                      }
                    />
                  ),
                })}
              </span>
            ) : (
              <TriggerFilter
                trigger={trigger}
                gifts={gifts}
                emotes={emotes}
                onChange={(changed) =>
                  onChange({ ...element, trigger: changed })
                }
              />
            )}
          </Field>
          {element.when === "event" ? (
            <div className={styles.pair}>
              <Field label={t("studio.fields.seconds")}>
                <NumberInput
                  min={1}
                  max={STUDIO_MAX_SECONDS}
                  value={element.seconds}
                  onChange={(seconds) => onChange({ ...element, seconds })}
                />
              </Field>
              <Field label={t("studio.fields.entrance")}>
                <Select
                  aria-label={t("studio.fields.entrance")}
                  options={entrances}
                  value={element.entrance}
                  onChange={(entrance) => onChange({ ...element, entrance })}
                />
              </Field>
            </div>
          ) : (
            <Field label={t("studio.fields.animation")}>
              <Select
                aria-label={t("studio.fields.animation")}
                options={animations}
                value={element.animation}
                onChange={(animation) => onChange({ ...element, animation })}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}
