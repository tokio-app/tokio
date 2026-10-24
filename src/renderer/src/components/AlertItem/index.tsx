import { Alert, ALERT_TRIGGERS, Trigger } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
} from "@/common/types";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { FiTrash2 } from "react-icons/fi";
import { Btn, Input, Select, SelectOption, Slider, Toggle } from "../Elements";
import { EmoteMultiSelect, EmoteOption } from "../EmoteSelect";
import { GiftMultiSelect } from "../GiftSelect";
import { PlayButton, TestState, testProps } from "../PlayButton";
import styles from "./alertitem.module.css";

// zod types the options as any live event, but they are the triggers.
export const TRIGGER_OPTIONS = ALERT_TRIGGERS.map((value) => ({
  value,
  label: ALERT_TRIGGER_LABELS[value],
})) as SelectOption<Trigger["type"]>[];

// When a gift alert plays, see every_gift
const GIFT_PLAYS: SelectOption<"streak" | "gift">[] = [
  { value: "streak", label: "When streak ends" },
  { value: "gift", label: "Every gift" },
];

type FilterProps = {
  trigger: Trigger;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  onChange: (trigger: Trigger) => void;
};

// Narrows the trigger: the gifts, emotes, chat keyword or viewer it reacts
// to. Alerts and game actions share it.
export function TriggerFilter({
  trigger,
  gifts,
  emotes,
  onChange,
}: FilterProps) {
  switch (trigger.type) {
    case TOKIO_EVENTS.GIFT:
      return (
        <div className={styles.stack}>
          <GiftMultiSelect
            placeholder="Any gift"
            gifts={gifts}
            value={trigger.gifts}
            onChange={(ids) => onChange({ ...trigger, gifts: ids })}
          />
          <Select
            className={styles.fill}
            aria-label="When it plays"
            options={GIFT_PLAYS}
            value={trigger.every_gift ? "gift" : "streak"}
            onChange={(plays) =>
              onChange({ ...trigger, every_gift: plays === "gift" })
            }
          />
        </div>
      );
    case EMOTE_TRIGGER:
      return (
        <EmoteMultiSelect
          placeholder="Any emote"
          emotes={emotes}
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
  emotes: EmoteOption[];
  // The sound test loading or playing, maybe this alert's
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  onChange: (alert: Alert) => void;
  onRemove: () => void;
  onPickSound: () => void;
  onPickMedia: () => void;
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
  onPickMedia,
}: Props) {
  const { sound, tts } = alert;
  const media = alert.media ?? undefined;
  // A message is spoken instead of the sound.
  const output = tts ? `TTS: ${tts.message}` : sound?.name;

  return (
    <div className={styles.row}>
      <div className={styles.cell}>
        <PlayButton
          {...testProps(testing, alert.id)}
          size={24}
          disabled={!sound && !tts && !media}
          onClick={() => {
            const { id, volume } = alert;
            const trigger = alert.trigger.type;
            if (tts) onTest({ id, tts, trigger, volume, media });
            else if (sound) onTest({ id, file: sound.file, volume, media });
            else if (media) onTest({ id, volume, media });
          }}
        />
        <Btn variant="icon" title="Remove" onClick={onRemove}>
          <FiTrash2 size={24} />
        </Btn>
      </div>

      <div className={styles.cell}>
        <Toggle
          aria-label="Enabled"
          checked={alert.enabled}
          onChange={(e) => onChange({ ...alert, enabled: e.target.checked })}
        />
      </div>

      <div className={styles.cell}>
        <Select
          className={styles.fill}
          aria-label="Trigger"
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
          trigger={alert.trigger}
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
        <Btn className={styles.sound} title={media?.name} onClick={onPickMedia}>
          <span className={styles.sound_name}>
            {media?.name ?? "Select media..."}
          </span>
        </Btn>
      </div>

      <div className={styles.cell}>
        <Slider
          aria-label="Volume"
          min={0}
          max={100}
          value={alert.volume}
          onChange={(volume) => onChange({ ...alert, volume })}
        />
      </div>
    </div>
  );
}
