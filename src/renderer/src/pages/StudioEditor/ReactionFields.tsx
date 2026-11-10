import { MessageKey } from "@/common/i18n";
import {
  STUDIO_ANIMATIONS,
  STUDIO_ENTRANCES,
  STUDIO_LOOPS,
  STUDIO_MAX_SECONDS,
  STUDIO_WHEN,
  StudioAnimation,
  StudioElement,
  StudioEntrance,
  StudioExit,
  StudioIdle,
  StudioWhen,
  Trigger,
} from "@/common/schemas";
import { CustomGift, TOKIO_EVENTS } from "@/common/types";
import {
  EmoteOption,
  Field,
  NumberInput,
  RadioGroup,
  Select,
  TriggerFilter,
} from "@/components";
import { rich, useOptions, useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

export const WHENS: { value: StudioWhen; label: MessageKey }[] =
  STUDIO_WHEN.map((value) => ({ value, label: `studio.when.${value}` }));

const ENTRANCES: { value: StudioEntrance; label: MessageKey }[] =
  STUDIO_ENTRANCES.map((value) => ({
    value,
    label: `studio.entrances.${value}`,
  }));

// An exit picks from the entrances' moves, worded on its own
const EXITS: { value: StudioExit; label: MessageKey }[] = STUDIO_ENTRANCES.map(
  (value) => ({ value, label: `studio.exits.${value}` }),
);

const ANIMATIONS: { value: StudioAnimation; label: MessageKey }[] =
  STUDIO_ANIMATIONS.map((value) => ({
    value,
    label: `studio.animations.${value}`,
  }));

const LOOPS: { value: StudioIdle; label: MessageKey }[] = STUDIO_LOOPS.map(
  (value) => ({ value, label: `studio.loops.${value}` }),
);

// What an element and a group share of how they react and move
export type Reaction = Pick<
  StudioElement,
  | "id"
  | "when"
  | "trigger"
  | "likes_every"
  | "seconds"
  | "entrance"
  | "exit"
  | "animation"
  | "idle"
>;

type Props<R extends Reaction> = {
  value: R;
  // The Whens and triggers it may pick, already translated
  whens: { value: StudioWhen; label: string }[];
  triggers: { value: Trigger["type"]; label: string }[];
  // A video without loop stays until it ends, not for seconds
  untilEnd: boolean;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  onChange: (value: R) => void;
};

/**
 * An element's or a group's When, and for it the trigger, the entrance,
 * exit and seconds, the animation, or the loop.
 */
export function ReactionFields<R extends Reaction>({
  value,
  whens,
  triggers,
  untilEnd,
  gifts,
  emotes,
  onChange,
}: Props<R>) {
  const t = useT();
  const entrances = useOptions(ENTRANCES);
  const exits = useOptions(EXITS);
  const animations = useOptions(ANIMATIONS);
  const loops = useOptions(LOOPS);
  const { trigger, when } = value;

  const triggerField = (
    <Field label={t("studio.fields.trigger")}>
      <Select
        aria-label={t("studio.fields.trigger")}
        options={triggers}
        value={trigger.type}
        onChange={(type) =>
          onChange({ ...value, trigger: { ...trigger, type } })
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
                value={value.likes_every}
                onChange={(likes_every) => onChange({ ...value, likes_every })}
              />
            ),
          })}
        </span>
      ) : (
        <TriggerFilter
          trigger={trigger}
          gifts={gifts}
          emotes={emotes}
          onChange={(changed) => onChange({ ...value, trigger: changed })}
        />
      )}
    </Field>
  );

  return (
    <>
      <Field label={t("studio.when.title")}>
        <RadioGroup
          name={`studio-when-${value.id}`}
          value={when}
          options={whens}
          onChange={(changed) => onChange({ ...value, when: changed })}
        />
      </Field>

      {when === "event" && (
        <>
          {triggerField}
          <div className={styles.pair}>
            <Field label={t("studio.fields.entrance")}>
              <Select
                aria-label={t("studio.fields.entrance")}
                options={entrances}
                value={value.entrance}
                onChange={(entrance) => onChange({ ...value, entrance })}
              />
            </Field>
            <Field label={t("studio.fields.exit")}>
              <Select
                aria-label={t("studio.fields.exit")}
                options={exits}
                value={value.exit}
                onChange={(exit) => onChange({ ...value, exit })}
              />
            </Field>
          </div>
          {/* Under the entrance, as wide, so the column lines up */}
          <div className={styles.pair}>
            <Field label={t("studio.fields.seconds")}>
              {untilEnd ? (
                <p className={styles.until}>{t("studio.fields.untilEnd")}</p>
              ) : (
                <NumberInput
                  scrub
                  min={1}
                  max={STUDIO_MAX_SECONDS}
                  value={value.seconds}
                  onChange={(seconds) => onChange({ ...value, seconds })}
                />
              )}
            </Field>
          </div>
        </>
      )}

      {when === "animate" && (
        <>
          {triggerField}
          <Field label={t("studio.fields.animation")}>
            <Select
              aria-label={t("studio.fields.animation")}
              options={animations}
              value={value.animation}
              onChange={(animation) => onChange({ ...value, animation })}
            />
          </Field>
        </>
      )}

      {when === "loop" && (
        <Field label={t("studio.fields.animation")}>
          <Select
            aria-label={t("studio.fields.animation")}
            options={loops}
            value={value.idle}
            onChange={(idle) => onChange({ ...value, idle })}
          />
        </Field>
      )}
    </>
  );
}
