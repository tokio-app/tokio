import { MessageKey } from "@/common/i18n";
import {
  STUDIO_ANIMATIONS,
  STUDIO_ENTRANCES,
  STUDIO_LOOPS,
  STUDIO_MAX_DELAY,
  STUDIO_MAX_SECONDS,
  STUDIO_MAX_TRIGGERS,
  STUDIO_WHEN,
  StudioAnimation,
  StudioCounter,
  StudioElement,
  StudioEntrance,
  StudioExit,
  StudioIdle,
  StudioTrigger,
  StudioTriggerSchema,
  StudioWhen,
  GOAL_TRIGGER,
} from "@/common/schemas";
import { CustomGift, TOKIO_EVENTS } from "@/common/types";
import { triggersOf } from "@/common/util";
import {
  Btn,
  EmoteOption,
  Field,
  NumberInput,
  RadioGroup,
  Select,
  TRIGGER_OPTIONS,
  TriggerFilter,
} from "@/components";
import { rich, useOptions, useT } from "@/ui/i18n";
import { ReactNode } from "react";
import { FiPlus, FiX } from "react-icons/fi";
import { goalNumbers, retype } from "./helper";
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

// An alert's triggers, then the Studio's own
export const STUDIO_TRIGGERS: {
  value: StudioTrigger["type"];
  label: MessageKey;
}[] = [
  ...TRIGGER_OPTIONS,
  { value: GOAL_TRIGGER, label: "studio.goal.trigger" },
];

// What an element and a group share of how they react and move
export type Reaction = Pick<
  StudioElement,
  | "id"
  | "when"
  | "trigger"
  | "also_triggers"
  | "delay"
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
  triggers: { value: StudioTrigger["type"]; label: string }[];
  // A video without loop stays until it ends, not for seconds
  untilEnd: boolean;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // The overlay's, which a goal can watch
  counters: StudioCounter[];
  onChange: (value: R) => void;
};

// What a new trigger row starts as, the schema's default
const newTrigger = () =>
  StudioTriggerSchema.parse({ type: TOKIO_EVENTS.FOLLOW, gifts: [] });

// Whole hundredths: a scrub's 0.1 steps add up to 0.30000000000000004
const hundredths = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * An element's or a group's When, and for it the triggers and the delay,
 * the entrance, exit and seconds, the animation, or the loop.
 */
export function ReactionFields<R extends Reaction>({
  value,
  whens,
  triggers,
  untilEnd,
  gifts,
  emotes,
  counters,
  onChange,
}: Props<R>) {
  const t = useT();
  const entrances = useOptions(ENTRANCES);
  const exits = useOptions(EXITS);
  const animations = useOptions(ANIMATIONS);
  const loops = useOptions(LOOPS);
  const { when } = value;
  const rows = triggersOf(value);
  // likes_every is one for all the Like rows, shown with the first
  const likesRow = rows.findIndex((r) => r.type === TOKIO_EVENTS.LIKE);
  const numbers = goalNumbers(counters);

  const setRow = (index: number, changed: StudioTrigger) =>
    onChange(
      index === 0
        ? { ...value, trigger: changed }
        : {
            ...value,
            also_triggers: value.also_triggers.map((other, i) =>
              i === index - 1 ? changed : other,
            ),
          },
    );

  const row = (index: number, label: string) => {
    const trigger = rows[index];
    let filter: ReactNode;
    if (trigger.type === GOAL_TRIGGER) {
      filter = (
        <span className={styles.likes}>
          {rich(t("studio.goal.reaches"), {
            number: (
              <Select
                className={styles.goal_number}
                aria-label={t("studio.goal.number")}
                options={numbers}
                value={trigger.number}
                onChange={(number) => setRow(index, { ...trigger, number })}
              />
            ),
            goal: (
              <NumberInput
                className={styles.number}
                scrub
                aria-label={t("studio.goal.goal")}
                integer
                min={1}
                value={trigger.goal}
                onChange={(goal) => setRow(index, { ...trigger, goal })}
              />
            ),
          })}
        </span>
      );
    } else if (index === likesRow) {
      // Counted as game actions count them, from all viewers
      filter = (
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
      );
    } else {
      filter = (
        <TriggerFilter
          trigger={trigger}
          gifts={gifts}
          emotes={emotes}
          onChange={(changed) => setRow(index, changed)}
        />
      );
    }
    return (
      <>
        <Select
          aria-label={label}
          options={triggers}
          value={trigger.type}
          onChange={(type) => setRow(index, retype(trigger, type))}
        />
        {filter}
      </>
    );
  };

  // With one trigger to pick, another row would only repeat it
  const adds = triggers.length > 1;
  const triggerFields = (
    <div className={styles.triggers}>
      <Field label={t("studio.fields.trigger")}>
        {row(0, t("studio.fields.trigger"))}
      </Field>
      {value.also_triggers.map((_, i) => {
        const number = String(i + 2);
        const name = t("studio.triggers.row", { number });
        const remove = t("studio.triggers.remove", { number });
        return (
          <div key={i} className={styles.titled} role="group" aria-label={name}>
            <div className={styles.titled_head}>
              <span className={styles.titled_name}>
                {t("studio.triggers.or")}
              </span>
              <Btn
                variant="icon"
                title={remove}
                aria-label={remove}
                onClick={() =>
                  onChange({
                    ...value,
                    also_triggers: value.also_triggers.filter(
                      (_, j) => j !== i,
                    ),
                  })
                }
              >
                <FiX size={16} />
              </Btn>
            </div>
            {row(i + 1, name)}
          </div>
        );
      })}
      {adds && (
        <Btn
          className={styles.add_trigger}
          disabled={rows.length >= STUDIO_MAX_TRIGGERS}
          onClick={() =>
            onChange({
              ...value,
              also_triggers: [...value.also_triggers, newTrigger()],
            })
          }
        >
          <FiPlus size={16} aria-hidden />
          {t("studio.triggers.add")}
        </Btn>
      )}
    </div>
  );

  const delayField = (
    <Field label={t("studio.fields.delay")}>
      <NumberInput
        scrub
        step={0.1}
        min={0}
        max={STUDIO_MAX_DELAY}
        value={value.delay}
        onChange={(delay) => onChange({ ...value, delay: hundredths(delay) })}
      />
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
          {triggerFields}
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
            {delayField}
          </div>
        </>
      )}

      {when === "animate" && (
        <>
          {triggerFields}
          <div className={styles.pair}>
            <Field label={t("studio.fields.animation")}>
              <Select
                aria-label={t("studio.fields.animation")}
                options={animations}
                value={value.animation}
                onChange={(animation) => onChange({ ...value, animation })}
              />
            </Field>
            {delayField}
          </div>
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
