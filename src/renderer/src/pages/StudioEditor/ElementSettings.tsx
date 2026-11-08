import { MessageKey } from "@/common/i18n";
import {
  STUDIO_MAX_BORDER,
  STUDIO_MAX_FONT_SIZE,
  STUDIO_MAX_SECONDS,
  STUDIO_NAME_MAX_LENGTH,
  STUDIO_TEXT_MAX_LENGTH,
  StudioAlign,
  StudioAnimation,
  StudioCrop,
  StudioEntrance,
  StudioElement,
  StudioWhen,
  Trigger,
} from "@/common/schemas";
import { CustomGift, EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { mediaKind, STUDIO_NUMBERS, studioEventVariables } from "@/common/util";
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
  TRIGGER_OPTIONS,
  TriggerFilter,
  VariableList,
} from "@/components";
import { rich, useOptions, useT } from "@/ui/i18n";
import { ReactNode, useRef } from "react";
import { BoxFields } from "./BoxFields";
import { alignTo, KIND_NAMES, sourceOf, sourceValue, Words } from "./helper";
import { PictureFields } from "./PictureFields";
import styles from "./studioeditor.module.css";
import { VideoFields } from "./VideoFields";

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

// A gift or emote element's picture: what its event sent, or one picked
type Picture = { value: "sent" | "picked"; label: MessageKey }[];
const GIFT_PICTURES: Picture = [
  { value: "sent", label: "studio.fields.giftSent" },
  { value: "picked", label: "studio.fields.giftPicked" },
];
const EMOTE_PICTURES: Picture = [
  { value: "sent", label: "studio.fields.emoteSent" },
  { value: "picked", label: "studio.fields.emotePicked" },
];

// Events no viewer sends, so a viewer's picture can't react to them
const NO_VIEWER: Trigger["type"][] = [
  TOKIO_EVENTS.ENVELOPE,
  TOKIO_EVENTS.SUPER_FAN_BOX,
  TOKIO_EVENTS.MUSIC_CHANGE,
];

const ALIGNS: { value: StudioAlign; label: MessageKey }[] = [
  { value: "left", label: "studio.aligns.left" },
  { value: "center", label: "studio.aligns.center" },
  { value: "right", label: "studio.aligns.right" },
];

type Props = {
  element: StudioElement;
  // What its row calls it with no label
  autoName: string;
  // The overlay's size, which the element lines up with
  canvas: { width: number; height: number };
  // Its width and height change together, in proportion
  linked: boolean;
  onLinked: (linked: boolean) => void;
  // A text's words, which its box keeps room for
  words?: Words;
  onChange: (element: StudioElement) => void;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // What an overlay element can frame
  sources: SelectOption<string>[];
  // Opens the media library for a media element
  onPickMedia: () => void;
  // A picture's crop typed in, and cropping it on the canvas
  onCrop: (crop: StudioCrop) => void;
  onCropCanvas: () => void;
  // A video's frame a cut's handle moved to, held still on the canvas
  onSeek: (seconds: number) => void;
  // Plays a video's cut again on the canvas
  onPlay: () => void;
};

/**
 * The selected element's name, its own fields, its box, flips and opacity,
 * and its When.
 */
export function ElementSettings({
  element,
  autoName,
  canvas,
  linked,
  onLinked,
  words,
  onChange,
  gifts,
  emotes,
  sources,
  onPickMedia,
  onCrop,
  onCropCanvas,
  onSeek,
  onPlay,
}: Props) {
  const t = useT();
  const textRef = useRef<HTMLInputElement>(null);
  const aligns = useOptions(ALIGNS);
  const allWhens = useOptions(WHENS);
  const entrances = useOptions(ENTRANCES);
  const animations = useOptions(ANIMATIONS);
  const allTriggers = useOptions(TRIGGER_OPTIONS);
  const giftPictures = useOptions(GIFT_PICTURES);
  const emotePictures = useOptions(EMOTE_PICTURES);
  // The trigger that sends what the element shows: the gift or the emote sent
  const sends =
    element.kind === "gift" && element.gift === null
      ? TOKIO_EVENTS.GIFT
      : element.kind === "emote" && element.emote === null
        ? EMOTE_TRIGGER
        : null;
  // A viewer's picture needs the viewer an event brings
  const triggers =
    element.kind === "viewer"
      ? allTriggers.filter((o) => !NO_VIEWER.includes(o.value))
      : sends
        ? allTriggers.filter((o) => o.value === sends)
        : allTriggers;
  const whens =
    element.kind === "viewer" || sends
      ? allWhens.filter((w) => w.value !== "always")
      : allWhens;
  // What the event sends shows: on that event, never always
  const onSent = <E extends StudioElement>(
    changed: E,
    type: Trigger["type"],
  ) => ({
    ...changed,
    when: changed.when === "always" ? "event" : changed.when,
    trigger: { ...changed.trigger, type },
  });
  const { trigger } = element;
  const video =
    element.kind === "media" &&
    !!element.file &&
    mediaKind(element.file) === "video";
  // On an event, a video without loop stays until it ends, not for seconds
  const untilEnd = video && element.kind === "media" && !element.loop;

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
            {/* The LIVE's numbers go in any text, the event's values only
                while it reacts to one */}
            <VariableList
              label={t("studio.variables.live")}
              variables={STUDIO_NUMBERS}
              inputRef={textRef}
              value={element.text}
              onChange={(text) => onChange({ ...element, text })}
            />
            {element.when !== "always" && (
              <VariableList
                label={t("studio.variables.event")}
                variables={studioEventVariables(element)}
                empty={t("common.noVariables")}
                inputRef={textRef}
                value={element.text}
                onChange={(text) => onChange({ ...element, text })}
              />
            )}
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
        <>
          <Field label={t("studio.fields.file")}>
            <Btn className={styles.file} onClick={onPickMedia}>
              <span className={styles.file_name}>
                {element.file ? element.name : t("studio.fields.pickFile")}
              </span>
            </Btn>
          </Field>
          {video && (
            <VideoFields
              key={element.file}
              element={element}
              onChange={onChange}
              onSeek={onSeek}
              onPlay={onPlay}
            />
          )}
        </>
      );
      break;
    case "gift":
      own = (
        <Field label={t("studio.fields.gift")}>
          <RadioGroup
            name={`studio-gift-${element.id}`}
            value={element.gift === null ? "sent" : "picked"}
            options={giftPictures}
            onChange={(picture) =>
              onChange(
                picture === "sent"
                  ? onSent({ ...element, gift: null }, TOKIO_EVENTS.GIFT)
                  : { ...element, gift: gifts[0]?.value ?? null },
              )
            }
          />
          {element.gift !== null && (
            <GiftSelect
              gifts={gifts}
              value={element.gift}
              onChange={(gift) => onChange({ ...element, gift })}
            />
          )}
        </Field>
      );
      break;
    case "emote":
      own = (
        <Field label={t("studio.fields.emote")}>
          <RadioGroup
            name={`studio-emote-${element.id}`}
            value={element.emote === null ? "sent" : "picked"}
            options={emotePictures}
            onChange={(picture) => {
              const first = emotes[0];
              if (picture === "sent") {
                onChange(onSent({ ...element, emote: null }, EMOTE_TRIGGER));
              } else if (first) {
                onChange({
                  ...element,
                  emote: { id: first.value, image: first.img },
                });
              }
            }}
          />
          {emotes.length === 0 ? (
            // Nothing to pick until viewers use emotes in chat
            <p className={styles.note}>{t("studio.fields.noEmotes")}</p>
          ) : element.emote === null ? null : (
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
        <>
          {/* Each on or off, its color beside it */}
          <div className={styles.paint}>
            <div
              role="group"
              aria-label={t("studio.fields.fill")}
              className={styles.paint_row}
            >
              <Check
                label={t("studio.fields.fill")}
                checked={element.fill}
                onChange={(e) =>
                  onChange({ ...element, fill: e.target.checked })
                }
              />
              {element.fill && (
                <Color
                  value={element.color}
                  onChange={(color) => onChange({ ...element, color })}
                />
              )}
            </div>
            <div
              role="group"
              aria-label={t("studio.fields.border")}
              className={styles.paint_row}
            >
              <Check
                label={t("studio.fields.border")}
                checked={element.border}
                onChange={(e) =>
                  onChange({ ...element, border: e.target.checked })
                }
              />
              {element.border && (
                <>
                  <Color
                    value={element.border_color}
                    onChange={(border_color) =>
                      onChange({ ...element, border_color })
                    }
                  />
                  <NumberInput
                    className={styles.number}
                    scrub
                    aria-label={t("studio.fields.borderWidth")}
                    integer
                    min={1}
                    max={STUDIO_MAX_BORDER}
                    value={element.border_width}
                    onChange={(border_width) =>
                      onChange({ ...element, border_width })
                    }
                  />
                </>
              )}
            </div>
          </div>
          <Field label={t("studio.fields.radius")}>
            <NumberInput
              scrub
              min={0}
              value={element.radius}
              onChange={(radius) => onChange({ ...element, radius })}
            />
          </Field>
        </>
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

  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t(KIND_NAMES[element.kind])}</h3>
      <Field label={t("common.name")}>
        <Input
          maxLength={STUDIO_NAME_MAX_LENGTH}
          placeholder={autoName}
          value={element.label}
          onChange={(e) => onChange({ ...element, label: e.target.value })}
        />
      </Field>
      {own}
      {"crop" in element && (
        <PictureFields
          crop={element.crop}
          rounding={element.rounding}
          onCropCanvas={element.kind === "viewer" ? null : onCropCanvas}
          onCrop={onCrop}
          onRounding={(rounding) => onChange({ ...element, rounding })}
        />
      )}

      <BoxFields
        box={element}
        flips={element}
        opacity={element.opacity}
        linked={linked}
        onLinked={onLinked}
        words={words}
        onBox={(box) => onChange({ ...element, ...box })}
        onFlip={(key) => {
          const next = { ...element };
          next[key] = !element[key];
          onChange(next);
        }}
        onAlign={(to) =>
          onChange({ ...element, ...alignTo(element, canvas, to) })
        }
        onOpacity={(opacity) => onChange({ ...element, opacity })}
      />

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
                      scrub
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
                {untilEnd ? (
                  <p className={styles.until}>{t("studio.fields.untilEnd")}</p>
                ) : (
                  <NumberInput
                    scrub
                    min={1}
                    max={STUDIO_MAX_SECONDS}
                    value={element.seconds}
                    onChange={(seconds) => onChange({ ...element, seconds })}
                  />
                )}
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
