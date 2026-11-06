import { MessageKey } from "@/common/i18n";
import {
  STUDIO_MAX_FONT_SIZE,
  STUDIO_MAX_SECONDS,
  STUDIO_TEXT_MAX_LENGTH,
  StudioAlign,
  StudioAnimation,
  StudioEntrance,
  StudioLayer,
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
  layer: StudioLayer;
  onChange: (layer: StudioLayer) => void;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // What an overlay layer can frame
  sources: SelectOption<string>[];
  // Opens the media library for a media layer
  onPickMedia: () => void;
};

/** The selected layer's own fields, its box and opacity, and its When. */
export function LayerSettings({
  layer,
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
    layer.kind === "viewer"
      ? allWhens.filter((w) => w.value !== "always")
      : allWhens;
  const { trigger } = layer;

  let own: ReactNode = null;
  switch (layer.kind) {
    case "text":
      own = (
        <>
          <Field label={t("studio.fields.text")}>
            <Input
              ref={textRef}
              maxLength={STUDIO_TEXT_MAX_LENGTH}
              value={layer.text}
              onChange={(e) => onChange({ ...layer, text: e.target.value })}
            />
            <VariableList
              variables={studioVariables(layer)}
              inputRef={textRef}
              value={layer.text}
              onChange={(text) => onChange({ ...layer, text })}
            />
          </Field>
          <Field label={t("studio.fields.font")}>
            <FontSelect
              value={layer.font}
              defaultLabel={t("common.defaultFont")}
              onChange={(font) => onChange({ ...layer, font })}
            />
          </Field>
          <div className={styles.pair}>
            <Field label={t("studio.fields.size")}>
              <NumberInput
                min={1}
                max={STUDIO_MAX_FONT_SIZE}
                value={layer.size}
                onChange={(size) => onChange({ ...layer, size })}
              />
            </Field>
            <Field label={t("studio.fields.color")}>
              <Color
                value={layer.color}
                onChange={(color) => onChange({ ...layer, color })}
              />
            </Field>
          </div>
          <Field label={t("studio.fields.align")} className={styles.inline}>
            <RadioGroup
              name={`studio-align-${layer.id}`}
              value={layer.align}
              options={aligns}
              onChange={(align) => onChange({ ...layer, align })}
            />
          </Field>
          <div className={styles.checks}>
            <Check
              label={t("studio.fields.bold")}
              checked={layer.bold}
              onChange={(e) => onChange({ ...layer, bold: e.target.checked })}
            />
            <Check
              label={t("studio.fields.halo")}
              checked={layer.halo}
              onChange={(e) => onChange({ ...layer, halo: e.target.checked })}
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
              {layer.file ? layer.name : t("studio.fields.pickFile")}
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
            value={layer.gift ?? undefined}
            onChange={(gift) => onChange({ ...layer, gift })}
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
              value={layer.emote?.id}
              onChange={(id) => {
                const emote = emotes.find((e) => e.value === id);
                if (emote) {
                  onChange({ ...layer, emote: { id, image: emote.img } });
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
              value={layer.color}
              onChange={(color) => onChange({ ...layer, color })}
            />
          </Field>
          <Field label={t("studio.fields.radius")}>
            <NumberInput
              min={0}
              value={layer.radius}
              onChange={(radius) => onChange({ ...layer, radius })}
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
            value={sourceValue(layer.source)}
            onChange={(value) =>
              onChange({ ...layer, source: sourceOf(value) })
            }
          />
        </Field>
      );
      break;
  }

  const box = (
    key: "x" | "y" | "width" | "height",
    label: MessageKey,
    min?: number,
  ) => (
    <Field label={t(label)}>
      <NumberInput
        className={styles.number}
        integer
        min={min}
        value={layer[key]}
        onChange={(value) => {
          const next = { ...layer };
          next[key] = value;
          onChange(next);
        }}
      />
    </Field>
  );

  const opacity = Math.round(layer.opacity * 100);

  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t(KIND_NAMES[layer.kind])}</h3>
      {own}

      <Field label={t("studio.fields.box")}>
        <div className={styles.box}>
          {box("x", "studio.fields.x")}
          {box("y", "studio.fields.y")}
          {box("width", "studio.fields.width", 1)}
          {box("height", "studio.fields.height", 1)}
        </div>
      </Field>
      <Field label={t("studio.fields.opacity", { opacity: String(opacity) })}>
        <Slider
          aria-label={t("studio.fields.opacity", { opacity: String(opacity) })}
          min={0}
          max={100}
          value={opacity}
          onChange={(value) => onChange({ ...layer, opacity: value / 100 })}
        />
      </Field>

      <Field label={t("studio.when.title")}>
        <RadioGroup
          name={`studio-when-${layer.id}`}
          value={layer.when}
          options={whens}
          onChange={(when) => onChange({ ...layer, when })}
        />
      </Field>

      {layer.when !== "always" && (
        <>
          <Field label={t("studio.fields.trigger")}>
            <Select
              aria-label={t("studio.fields.trigger")}
              options={triggers}
              value={trigger.type}
              onChange={(type) =>
                onChange({ ...layer, trigger: { ...trigger, type } })
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
                      value={layer.likes_every}
                      onChange={(likes_every) =>
                        onChange({ ...layer, likes_every })
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
                onChange={(changed) => onChange({ ...layer, trigger: changed })}
              />
            )}
          </Field>
          {layer.when === "event" ? (
            <div className={styles.pair}>
              <Field label={t("studio.fields.seconds")}>
                <NumberInput
                  min={1}
                  max={STUDIO_MAX_SECONDS}
                  value={layer.seconds}
                  onChange={(seconds) => onChange({ ...layer, seconds })}
                />
              </Field>
              <Field label={t("studio.fields.entrance")}>
                <Select
                  aria-label={t("studio.fields.entrance")}
                  options={entrances}
                  value={layer.entrance}
                  onChange={(entrance) => onChange({ ...layer, entrance })}
                />
              </Field>
            </div>
          ) : (
            <Field label={t("studio.fields.animation")}>
              <Select
                aria-label={t("studio.fields.animation")}
                options={animations}
                value={layer.animation}
                onChange={(animation) => onChange({ ...layer, animation })}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}
