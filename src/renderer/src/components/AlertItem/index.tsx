import { Alert, ALERT_TRIGGERS } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
} from "@/common/types";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { FiTrash2 } from "react-icons/fi";
import {
  Btn,
  Input,
  MultiSelect,
  Select,
  SelectOption,
  Slider,
  Toggle,
} from "../Elements";
import { PlayButton, TestState, testProps } from "../PlayButton";
import styles from "./alertitem.module.css";

type Trigger = Alert["trigger"]["type"];

// zod types the options as any live event, but they are the triggers.
const TRIGGER_OPTIONS = ALERT_TRIGGERS.map((value) => ({
  value,
  label: ALERT_TRIGGER_LABELS[value],
})) as SelectOption<Trigger>[];

type FilterProps = {
  alert: Alert;
  gifts: CustomGift[];
  emotes: SelectOption<string>[];
  onChange: (trigger: Alert["trigger"]) => void;
};

// Narrows the trigger: the gifts, emotes, chat keyword or viewer it reacts to.
function TriggerFilter({ alert, gifts, emotes, onChange }: FilterProps) {
  const { trigger } = alert;

  switch (trigger.type) {
    case TOKIO_EVENTS.GIFT:
      return (
        <MultiSelect
          className={styles.fill}
          searchable
          placeholder="Any gift"
          options={gifts}
          value={trigger.gifts}
          onChange={(ids) => onChange({ ...trigger, gifts: ids })}
        />
      );
    case EMOTE_TRIGGER:
      return (
        <MultiSelect
          className={styles.fill}
          placeholder="Any emote"
          options={emotes}
          value={trigger.emotes}
          onChange={(ids) => onChange({ ...trigger, emotes: ids })}
        />
      );
    case TOKIO_EVENTS.CHAT:
      return (
        <Input
          className={styles.fill}
          placeholder="Any message"
          value={trigger.keyword}
          onChange={(e) => onChange({ ...trigger, keyword: e.target.value })}
        />
      );
    case TOKIO_EVENTS.MEMBER_JOIN:
    case TOKIO_EVENTS.SUPER_FAN_JOIN:
      return (
        <Input
          className={styles.fill}
          placeholder="Anyone"
          title="A viewer's @handle or name"
          value={trigger.user}
          onChange={(e) => onChange({ ...trigger, user: e.target.value })}
        />
      );
    default:
      return <div className={styles.delimiter} />;
  }
}

type Props = {
  alert: Alert;
  gifts: CustomGift[];
  emotes: SelectOption<string>[];
  // The sound test loading or playing, maybe this alert's
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  onChange: (alert: Alert) => void;
  onRemove: () => void;
  onPickSound: () => void;
};

export function AlertItem({
  alert,
  gifts,
  emotes,
  testing,
  onTest,
  onChange,
  onRemove,
  onPickSound,
}: Props) {
  const { sound, tts } = alert;
  // A message is spoken instead of the sound.
  const output = tts ? `TTS: ${tts.message}` : sound?.name;

  return (
    <div className={styles.row}>
      <div className={styles.cell}>
        <PlayButton
          {...testProps(testing, alert.id)}
          size={24}
          disabled={!sound && !tts}
          onClick={() => {
            const { id, volume } = alert;
            if (tts) onTest({ id, tts, trigger: alert.trigger.type, volume });
            else if (sound) onTest({ id, file: sound.file, volume });
          }}
        />
        <Btn variant="icon" title="Remove" onClick={onRemove}>
          <FiTrash2 size={24} />
        </Btn>
      </div>

      <div className={styles.cell}>
        <Toggle
          checked={alert.enabled}
          onChange={(e) => onChange({ ...alert, enabled: e.target.checked })}
        />
      </div>

      <div className={styles.cell}>
        <Select
          className={styles.fill}
          placeholder="Select a trigger..."
          options={TRIGGER_OPTIONS}
          value={alert.trigger.type}
          onChange={(type) =>
            onChange({ ...alert, trigger: { ...alert.trigger, type } })
          }
        />
      </div>

      <div className={styles.cell}>
        <TriggerFilter
          alert={alert}
          gifts={gifts}
          emotes={emotes}
          onChange={(trigger) => onChange({ ...alert, trigger })}
        />
      </div>

      <div className={styles.cell}>
        <Btn className={styles.sound} title={output} onClick={onPickSound}>
          <span className={styles.sound_name}>
            {output ?? "Select a sound..."}
          </span>
        </Btn>
      </div>

      <div className={styles.cell}>
        <Slider
          min={0}
          max={100}
          value={alert.volume}
          onChange={(volume) => onChange({ ...alert, volume })}
        />
      </div>
    </div>
  );
}
