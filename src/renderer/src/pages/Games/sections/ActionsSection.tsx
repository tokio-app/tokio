import {
  GAME_STEP_MAX_AMOUNT,
  GameAction,
  GameStep,
  Profile,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CommandResult,
  CustomGift,
  TOKIO_EVENTS,
} from "@/common/types";
import { ALERT_MESSAGE_VARIABLES } from "@/common/util";
import {
  Btn,
  EmoteOption,
  EmptyState,
  Input,
  NumberInput,
  Section,
  Select,
  Toggle,
  TRIGGER_OPTIONS,
  TriggerFilter,
  VariableList,
} from "@/components";
import { Updater, useIpcListener } from "@/hooks";
import { Ref, useRef, useState } from "react";
import {
  FiCheck,
  FiChevronRight,
  FiPlay,
  FiPlus,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import styles from "../games.module.css";
import {
  createAction,
  createStep,
  ITEMS,
  MOBS,
  STEP_KINDS,
  stepText,
  testSummary,
  TIMES,
  WEATHERS,
  withText,
} from "../helper";

type Props = {
  actions: GameAction[];
  gifts: CustomGift[];
  emotes: EmoteOption[];
  update: Updater<Profile["games"]>;
};

export function ActionsSection({ actions, gifts, emotes, update }: Props) {
  return (
    <Section
      title="Actions"
      description="What viewers set off in your world."
      actions={
        <Btn
          title="Add action"
          onClick={() =>
            update((s) => {
              s.actions.push(createAction("bedrock"));
            })
          }
        >
          <FiPlus size={20} />
        </Btn>
      }
    >
      {actions.length === 0 ? (
        <EmptyState>
          No actions yet. Use the add button to create one.
        </EmptyState>
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
  onRemove: () => void;
};

type TestResult = { results: CommandResult[]; error?: string };

// A test sends up to 100 commands; the last ones are enough to read
const RESULTS_SHOWN = 25;

function ActionItem({ action, gifts, emotes, onChange, onRemove }: ItemProps) {
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
          aria-label="Enabled"
          checked={action.enabled}
          onChange={(e) => onChange({ ...action, enabled: e.target.checked })}
        />
        <Select
          className={styles.trigger}
          aria-label="Trigger"
          options={TRIGGER_OPTIONS}
          value={trigger.type}
          onChange={(type) =>
            onChange({ ...action, trigger: { ...trigger, type } })
          }
        />
        {/* Its line for triggers without a filter isn't needed here */}
        <div className={styles.filter}>
          <TriggerFilter
            trigger={trigger}
            gifts={gifts}
            emotes={emotes}
            onChange={(changed) => onChange({ ...action, trigger: changed })}
          />
        </div>
        <div className={styles.action_buttons}>
          <Btn
            variant="icon"
            title="Test"
            aria-label="Test"
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
          <Btn variant="icon" title="Remove action" onClick={onRemove}>
            <FiTrash2 size={20} />
          </Btn>
        </div>
      </div>

      {steps.length > 0 && (
        <ol className={styles.steps} aria-label="Steps">
          {steps.map((step, index) => (
            <li key={index} className={styles.step}>
              <Select
                className={styles.kind}
                aria-label="Step"
                options={STEP_KINDS}
                value={step.type}
                onChange={(kind) => {
                  if (kind !== step.type) setStep(index, createStep(kind));
                }}
              />
              <StepFields
                step={step}
                textRef={index === target ? textRef : undefined}
                onFocusText={() => setFocused(index)}
                onChange={(changed) => setStep(index, changed)}
              />
              <Btn
                variant="icon"
                className={styles.remove_step}
                title="Remove step"
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
          <FiPlus size={16} /> Add step
        </Btn>
        {target !== -1 && (
          <VariableList
            variables={variables}
            inputRef={textRef}
            value={stepText(steps[target]) ?? ""}
            onChange={(text) => setStep(target, withText(steps[target], text))}
            empty="This event has no variables."
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
                {testSummary(result.results)}
              </summary>
              {result.results.length > RESULTS_SHOWN && (
                <p className={styles.result_note}>
                  Showing the last {RESULTS_SHOWN}.
                </p>
              )}
              <ul className={styles.result_list}>
                {result.results.slice(-RESULTS_SHOWN).map((r, index) => (
                  <li
                    key={index}
                    className={r.ok ? styles.result : styles.result_failed}
                  >
                    {r.ok ? (
                      <FiCheck role="img" aria-label="Ran" size={16} />
                    ) : (
                      <FiX role="img" aria-label="Failed" size={16} />
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

type FieldsProps = {
  step: GameStep;
  // On the text field the variables go into
  textRef?: Ref<HTMLInputElement>;
  onFocusText: () => void;
  onChange: (step: GameStep) => void;
};

// The rest of the step's sentence, after its kind
function StepFields({ step, textRef, onFocusText, onChange }: FieldsProps) {
  switch (step.type) {
    case "spawn":
      return (
        <>
          <Select
            searchable
            className={styles.thing}
            aria-label="Mob"
            options={MOBS.bedrock}
            value={step.mob}
            onChange={(mob) => onChange({ ...step, mob })}
          />
          <Amount
            value={step.amount}
            onChange={(amount) => onChange({ ...step, amount })}
          />
          <span className={styles.word}>named</span>
          <Input
            ref={textRef}
            className={styles.name}
            aria-label="Name"
            placeholder="No name"
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
            aria-label="Item"
            options={ITEMS.bedrock}
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
          aria-label="Weather"
          options={WEATHERS}
          value={step.weather}
          onChange={(weather) => onChange({ ...step, weather })}
        />
      );
    case "time":
      return (
        <Select
          className={styles.thing}
          aria-label="Time of day"
          options={TIMES}
          value={step.time}
          onChange={(time) => onChange({ ...step, time })}
        />
      );
    default:
      return (
        <Input
          ref={textRef}
          className={styles.command}
          aria-label="Command"
          placeholder="say Thanks {username}!"
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
  return (
    <>
      <span className={styles.word}>×</span>
      <NumberInput
        className={styles.amount}
        aria-label="Amount"
        integer
        min={1}
        max={GAME_STEP_MAX_AMOUNT}
        value={value}
        onChange={onChange}
      />
    </>
  );
}
