import {
  GAME_STEP_MAX_AMOUNT,
  GameAction,
  GameStep,
  MinecraftEdition,
  Profile,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CommandResult,
  CustomGift,
  TOKIO_EVENTS,
} from "@/common/types";
import { ALERT_MESSAGE_VARIABLES, REPEATED_HAZARDS } from "@/common/util";
import {
  Btn,
  EmoteOption,
  EmptyState,
  Input,
  NumberInput,
  Section,
  Select,
  Toggle,
  TriggerFilter,
  VariableList,
} from "@/components";
import { Updater, useIpcListener } from "@/hooks";
import { MessageKey } from "@/common/i18n";
import { rich, useLanguage, useOptions, useT } from "@/ui/i18n";
import { ReactNode, Ref, useRef, useState } from "react";
import {
  FiCheck,
  FiChevronRight,
  FiCopy,
  FiPlay,
  FiPlus,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import styles from "../games.module.css";
import {
  createAction,
  createStep,
  EDITIONS,
  GAME_TRIGGERS,
  HAZARDS,
  HELPS,
  ITEMS,
  MOBS,
  STEP_KINDS,
  stepText,
  testSummary,
  TIMES,
  WEATHERS,
  withEdition,
  withText,
} from "../helper";

type Props = {
  actions: GameAction[];
  // New actions' edition: the connected game's, else Bedrock
  edition: MinecraftEdition;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  update: Updater<Profile["games"]>;
};

export function ActionsSection({
  actions,
  edition,
  gifts,
  emotes,
  update,
}: Props) {
  const t = useT();
  return (
    <Section
      title={t("games.actions.title")}
      description={t("games.actions.description")}
      actions={
        <Btn
          title={t("games.actions.add")}
          onClick={() =>
            update((s) => {
              s.actions.push(createAction(edition));
            })
          }
        >
          <FiPlus size={20} />
        </Btn>
      }
    >
      {actions.length === 0 ? (
        <EmptyState>{t("games.actions.empty")}</EmptyState>
      ) : (
        <ul className={styles.actions}>
          {actions.map((action) => (
            <ActionItem
              key={action.id}
              action={action}
              gifts={gifts}
              emotes={emotes}
              onChange={(changed) =>
                update((s) => {
                  const index = s.actions.findIndex((a) => a.id === changed.id);
                  if (index !== -1) s.actions[index] = changed;
                })
              }
              onDuplicate={() =>
                update((s) => {
                  const index = s.actions.findIndex((a) => a.id === action.id);
                  const copy = structuredClone(action);
                  s.actions.splice(index + 1, 0, {
                    ...copy,
                    id: crypto.randomUUID(),
                  });
                })
              }
              onRemove={() =>
                update((s) => {
                  s.actions = s.actions.filter((a) => a.id !== action.id);
                })
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

type ItemProps = {
  action: GameAction;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  onChange: (action: GameAction) => void;
  onDuplicate: () => void;
  onRemove: () => void;
};

type TestResult = { results: CommandResult[]; error?: string };

// A test sends up to 100 commands; the last ones are enough to read
const RESULTS_SHOWN = 25;

// A sentence with fields inside, its words in spans between them
const sentence = (message: string, fields: Record<string, ReactNode>) =>
  rich(message, fields).map((part, i) =>
    typeof part === "string"
      ? part.trim() && (
          <span key={i} className={styles.word}>
            {part.trim()}
          </span>
        )
      : part,
  );

function ActionItem({
  action,
  gifts,
  emotes,
  onChange,
  onDuplicate,
  onRemove,
}: ItemProps) {
  const t = useT();
  const language = useLanguage();
  const triggers = useOptions(GAME_TRIGGERS);
  const kinds = useOptions(STEP_KINDS);
  const { trigger, steps } = action;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  // The text field the variables go into: the last one focused, or the first
  const [focused, setFocused] = useState(-1);
  const textRef = useRef<HTMLInputElement>(null);
  const target =
    focused !== -1 && steps[focused] && stepText(steps[focused]) !== null
      ? focused
      : steps.findIndex((step) => stepText(step) !== null);
  // A gift on every gift runs once for each, it has no count to say.
  const variables =
    trigger.type === TOKIO_EVENTS.GIFT && trigger.every_gift
      ? ALERT_MESSAGE_VARIABLES[trigger.type].filter((name) => name !== "count")
      : ALERT_MESSAGE_VARIABLES[trigger.type];

  useIpcListener(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, (res) => {
    if (!res || res.id !== action.id) return;
    setTesting(false);
    setResult({ results: res.results, error: res.error?.message });
  });

  const setSteps = (next: GameStep[]) => onChange({ ...action, steps: next });
  const setStep = (index: number, step: GameStep) =>
    setSteps(steps.map((s, i) => (i === index ? step : s)));

  return (
    <li className={styles.action}>
      <div className={styles.action_header}>
        <Toggle
          aria-label={t("common.enabled")}
          checked={action.enabled}
          onChange={(e) => onChange({ ...action, enabled: e.target.checked })}
        />
        <Select
          className={styles.edition_select}
          aria-label={t("games.actions.edition")}
          options={EDITIONS}
          value={action.edition}
          onChange={(edition) => onChange(withEdition(action, edition))}
        />
        <Select
          className={styles.trigger}
          aria-label={t("games.actions.trigger")}
          options={triggers}
          value={trigger.type}
          onChange={(type) =>
            onChange({ ...action, trigger: { ...trigger, type } })
          }
        />
        <div className={styles.filter}>
          {trigger.type === TOKIO_EVENTS.LIKE ? (
            // Counted as the countdown timer counts them, from all viewers
            <span className={styles.likes}>
              {sentence(t("games.actions.likesEvery"), {
                likes: (
                  <NumberInput
                    className={styles.amount}
                    aria-label={t("games.actions.likesPerRun")}
                    integer
                    min={1}
                    value={action.likes_every}
                    onChange={(likes_every) =>
                      onChange({ ...action, likes_every })
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
              onChange={(changed) => onChange({ ...action, trigger: changed })}
            />
          )}
        </div>
        <div className={styles.action_buttons}>
          <Btn
            variant="icon"
            title={t("common.test")}
            aria-label={t("common.test")}
            loading={testing}
            disabled={steps.length === 0}
            onClick={() => {
              setTesting(true);
              window.api.emit(APP_EVENTS.TEST_GAME_ACTION, {
                id: action.id,
                edition: action.edition,
                trigger: trigger.type,
                steps,
              });
            }}
          >
            <FiPlay size={20} />
          </Btn>
          <Btn
            variant="icon"
            title={t("games.actions.duplicate")}
            onClick={onDuplicate}
          >
            <FiCopy size={20} />
          </Btn>
          <Btn
            variant="icon"
            title={t("games.actions.remove")}
            onClick={onRemove}
          >
            <FiTrash2 size={20} />
          </Btn>
        </div>
      </div>

      {steps.length > 0 && (
        <ol className={styles.steps} aria-label={t("games.actions.steps")}>
          {steps.map((step, index) => (
            <li key={index} className={styles.step}>
              <Select
                className={styles.kind}
                aria-label={t("games.actions.step")}
                options={kinds}
                value={step.type}
                onChange={(kind) => {
                  if (kind !== step.type) setStep(index, createStep(kind));
                }}
              />
              <StepFields
                step={step}
                edition={action.edition}
                textRef={index === target ? textRef : undefined}
                onFocusText={() => setFocused(index)}
                onChange={(changed) => setStep(index, changed)}
              />
              <Btn
                variant="icon"
                className={styles.remove_step}
                title={t("games.actions.removeStep")}
                onClick={() => setSteps(steps.filter((_, i) => i !== index))}
              >
                <FiX size={18} />
              </Btn>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.action_footer}>
        <Btn onClick={() => setSteps([...steps, createStep("spawn")])}>
          <FiPlus size={16} /> {t("games.actions.addStep")}
        </Btn>
        {target !== -1 && (
          <VariableList
            variables={variables}
            inputRef={textRef}
            value={stepText(steps[target]) ?? ""}
            onChange={(text) => setStep(target, withText(steps[target], text))}
            empty={t("games.actions.noVariables")}
          />
        )}
      </div>

      {result && (
        <div className={styles.results}>
          {result.error && (
            <p className={styles.result_error}>{result.error}</p>
          )}
          {result.results.length > 0 && (
            // Opens with the first results; once folded, later tests keep it
            <details open className={styles.result_log}>
              <summary className={styles.result_summary}>
                <FiChevronRight size={16} />
                {testSummary(result.results, language)}
              </summary>
              {result.results.length > RESULTS_SHOWN && (
                <p className={styles.result_note}>
                  {t("games.test.lastShown", { shown: String(RESULTS_SHOWN) })}
                </p>
              )}
              <ul className={styles.result_list}>
                {result.results.slice(-RESULTS_SHOWN).map((r, index) => (
                  <li
                    key={index}
                    className={r.ok ? styles.result : styles.result_failed}
                  >
                    {r.ok ? (
                      <FiCheck
                        role="img"
                        aria-label={t("games.test.okLabel")}
                        size={16}
                      />
                    ) : (
                      <FiX
                        role="img"
                        aria-label={t("games.test.failedLabel")}
                        size={16}
                      />
                    )}
                    <code className={styles.result_command}>{r.command}</code>
                    <span className={styles.result_message}>{r.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

// The hazards that last the duration set
const EFFECT_HAZARDS: string[] = ["freeze", "lights_out", "dizzy"];

// A TNT's fuse. Bedrock's TNT has only two fuses, said after it.
function fuseText(edition: MinecraftEdition, fuse: number): MessageKey {
  if (edition !== "bedrock") return "games.step.fuse";
  return fuse <= 2
    ? "games.step.fuseBedrockShort"
    : "games.step.fuseBedrockLong";
}

type FieldsProps = {
  step: GameStep;
  // Whose mobs and items to list
  edition: MinecraftEdition;
  // On the text field the variables go into
  textRef?: Ref<HTMLInputElement>;
  onFocusText: () => void;
  onChange: (step: GameStep) => void;
};

// The rest of the step's sentence, after its kind
function StepFields({
  step,
  edition,
  textRef,
  onFocusText,
  onChange,
}: FieldsProps) {
  const t = useT();
  const weathers = useOptions(WEATHERS);
  const times = useOptions(TIMES);
  const hazards = useOptions(HAZARDS);
  const helps = useOptions(HELPS);
  switch (step.type) {
    case "spawn":
      return (
        <>
          <Select
            searchable
            className={styles.thing}
            aria-label={t("games.step.mob")}
            options={MOBS[edition]}
            value={step.mob}
            onChange={(mob) => onChange({ ...step, mob })}
          />
          <Amount
            value={step.amount}
            onChange={(amount) => onChange({ ...step, amount })}
          />
          <span className={styles.word}>{t("games.step.named")}</span>
          <Input
            ref={textRef}
            className={styles.name}
            aria-label={t("games.step.name")}
            placeholder={t("games.overlay.noName")}
            value={step.name}
            onFocus={onFocusText}
            onChange={(e) => onChange({ ...step, name: e.target.value })}
          />
        </>
      );
    case "give":
      return (
        <>
          <Select
            searchable
            className={styles.thing}
            aria-label={t("games.step.item")}
            options={ITEMS[edition]}
            value={step.item}
            onChange={(item) => onChange({ ...step, item })}
          />
          <Amount
            value={step.amount}
            onChange={(amount) => onChange({ ...step, amount })}
          />
        </>
      );
    case "weather":
      return (
        <Select
          className={styles.thing}
          aria-label={t("games.steps.weather")}
          options={weathers}
          value={step.weather}
          onChange={(weather) => onChange({ ...step, weather })}
        />
      );
    case "time":
      return (
        <Select
          className={styles.thing}
          aria-label={t("games.steps.time")}
          options={times}
          value={step.time}
          onChange={(time) => onChange({ ...step, time })}
        />
      );
    case "hazard":
      return (
        <>
          <Select
            className={styles.thing}
            aria-label={t("games.steps.hazard")}
            options={hazards}
            value={step.hazard}
            onChange={(hazard) => onChange({ ...step, hazard })}
          />
          {REPEATED_HAZARDS.includes(step.hazard) && (
            <Amount
              value={step.amount}
              onChange={(amount) => onChange({ ...step, amount })}
            />
          )}
          {(step.hazard === "tnt" || step.hazard === "tnt_ring") &&
            sentence(t(fuseText(edition, step.fuse)), {
              fuse: (
                <NumberInput
                  className={styles.amount}
                  aria-label={t("games.step.fuseLabel")}
                  min={0}
                  max={30}
                  step={0.5}
                  value={step.fuse}
                  onChange={(fuse) => onChange({ ...step, fuse })}
                />
              ),
            })}
          {(step.hazard === "launch" || step.hazard === "launch_water") &&
            sentence(t("games.step.launch"), {
              height: (
                <NumberInput
                  className={styles.amount}
                  aria-label={t("games.step.heightLabel")}
                  integer
                  min={5}
                  max={300}
                  value={step.height}
                  onChange={(height) => onChange({ ...step, height })}
                />
              ),
              seconds: (
                <NumberInput
                  className={styles.amount}
                  aria-label={t("games.step.secondsLabel")}
                  integer
                  min={1}
                  max={10}
                  value={step.seconds}
                  onChange={(seconds) => onChange({ ...step, seconds })}
                />
              ),
            })}
          {EFFECT_HAZARDS.includes(step.hazard) &&
            sentence(t("games.step.duration"), {
              duration: (
                <NumberInput
                  className={styles.amount}
                  aria-label={t("games.step.durationLabel")}
                  integer
                  min={1}
                  max={120}
                  value={step.duration}
                  onChange={(duration) => onChange({ ...step, duration })}
                />
              ),
            })}
          {step.hazard === "random_teleport" &&
            sentence(t("games.step.teleport"), {
              distance: (
                <NumberInput
                  className={styles.amount}
                  aria-label={t("games.step.distanceLabel")}
                  integer
                  min={10}
                  max={10_000}
                  value={step.distance}
                  onChange={(distance) => onChange({ ...step, distance })}
                />
              ),
            })}
        </>
      );
    case "help":
      return (
        <>
          <Select
            className={styles.thing}
            aria-label={t("games.steps.help")}
            options={helps}
            value={step.help}
            onChange={(help) => onChange({ ...step, help })}
          />
          {/* Armor and the heal are given at once; the rest are effects */}
          {step.help !== "netherite_armor" &&
            step.help !== "heal" &&
            sentence(t("games.step.duration"), {
              duration: (
                <NumberInput
                  className={styles.amount}
                  aria-label={t("games.step.durationLabel")}
                  integer
                  min={1}
                  max={600}
                  value={step.duration}
                  onChange={(duration) => onChange({ ...step, duration })}
                />
              ),
            })}
        </>
      );
    default:
      return (
        <Input
          ref={textRef}
          className={styles.command}
          aria-label={t("games.steps.command")}
          placeholder={t("games.step.commandPlaceholder")}
          spellCheck={false}
          value={step.command}
          onFocus={onFocusText}
          onChange={(e) => onChange({ ...step, command: e.target.value })}
        />
      );
  }
}

function Amount({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const t = useT();
  return (
    <>
      <span className={styles.word}>×</span>
      <NumberInput
        className={styles.amount}
        aria-label={t("games.step.amount")}
        integer
        min={1}
        max={GAME_STEP_MAX_AMOUNT}
        value={value}
        onChange={onChange}
      />
    </>
  );
}
