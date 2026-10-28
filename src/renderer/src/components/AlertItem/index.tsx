import { listOf, MessageKey, translate } from "@/common/i18n";
import { Alert, ALERT_TRIGGERS, Trigger, ViewerRole } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  alertName,
  formatAdded,
  getAlertOverlayURL,
  giftNames,
  takesRoles,
} from "@/common/util";
import { cx } from "@/helper/cx";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useLanguage, useT } from "@/ui/i18n";
import { FiEdit2, FiMessageSquare, FiMusic, FiTrash2 } from "react-icons/fi";
import { CopyButton } from "../CopyField";
import { Btn, Input, Select, SelectOption, Toggle } from "../Elements";
import { EmoteMultiSelect, EmoteOption } from "../EmoteSelect";
import { GiftMultiSelect } from "../GiftSelect";
import { MediaThumbnail } from "../MediaPicker";
import { PlayButton, TestState, testProps } from "../PlayButton";
import { SoundLength } from "../SoundPicker/SoundLength";
import styles from "./alertitem.module.css";

// The triggers, their labels keys (see useOptions)
export const TRIGGER_OPTIONS: { value: Trigger["type"]; label: MessageKey }[] =
  ALERT_TRIGGERS.map((value) => ({
    value,
    label: ALERT_TRIGGER_LABELS[value],
  }));

// When a gift alert plays, see every_gift
const GIFT_PLAYS: SelectOption<"streak" | "gift">[] = [
  { value: "streak", label: "When streak ends" },
  { value: "gift", label: "Every gift" },
];

// As the summary names them, keys translated where they show
export const ROLE_NAMES: Record<ViewerRole, MessageKey> = {
  follower: "roles.follower",
  moderator: "roles.moderator",
  superfan: "roles.superfan",
};

type FilterProps = {
  trigger: Trigger;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  onChange: (trigger: Trigger) => void;
};

// Narrows the trigger: the gifts, emotes, chat keyword or viewer it reacts
// to. Alerts and game actions share it. Nothing for other triggers.
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
      return null;
  }
}

// The most gifts or emotes a summary names, the rest counted
const NAMED = 3;

/**
 * What narrows the trigger, as one sentence in the language: "Rose or Lion,
 * when the streak ends, worth 100+ coins, from Followers". Empty when nothing
 * does.
 */
export function triggerSummary(
  trigger: Trigger,
  gifts: CustomGift[],
  emotes: EmoteOption[],
  language: string,
): string {
  const parts: string[] = [];
  switch (trigger.type) {
    case TOKIO_EVENTS.GIFT:
      parts.push(
        trigger.gifts.length === 0
          ? "Any gift"
          : // Gifts the lists don't have yet, until they load
            (giftNames(trigger.gifts, gifts, language, NAMED) ?? "Some gifts"),
        trigger.every_gift ? "every gift" : "when the streak ends",
      );
      // Only any gift has a worth to reach
      if (trigger.gifts.length === 0 && trigger.min_coins > 0) {
        parts.push(`worth ${trigger.min_coins}+ coins`);
      }
      break;
    case EMOTE_TRIGGER: {
      const names = trigger.emotes.flatMap(
        (id) => emotes.find((emote) => emote.value === id)?.label ?? [],
      );
      parts.push(
        names.length > 0
          ? listOf(language, names, { type: "or", max: NAMED })
          : "Any emote",
      );
      break;
    }
    case TOKIO_EVENTS.CHAT: {
      const keyword = trigger.keyword.trim();
      parts.push(keyword ? `Messages with “${keyword}”` : "Any message");
      break;
    }
    case TOKIO_EVENTS.MEMBER_JOIN:
    case TOKIO_EVENTS.SUPER_FAN_JOIN: {
      const user = trigger.user.trim();
      parts.push(user ? `Only ${user}` : "Anyone");
      break;
    }
  }
  if (takesRoles(trigger.type) && trigger.roles.length > 0) {
    const roles = listOf(
      language,
      trigger.roles.map((role) => translate(language, ROLE_NAMES[role])),
      { type: "or" },
    );
    parts.push(`from ${roles}`);
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The test of what the alert plays and shows, null when it has nothing. */
export function alertTest(alert: Alert): AlertTestRequest | null {
  const { id, volume, sound, tts } = alert;
  const media = alert.media ?? undefined;
  if (tts) return { id, tts, trigger: alert.trigger.type, volume, media };
  if (sound) {
    const { file, start } = sound;
    return { id, file, volume, media, start, end: sound.end ?? undefined };
  }
  return media ? { id, volume, media } : null;
}

type Props = {
  alert: Alert;
  // Its place in the list, which its default name counts
  index: number;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // The sound test loading or playing, maybe this alert's
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  onChange: (alert: Alert) => void;
  // Opens the alert's editor
  onEdit: () => void;
  onRemove: () => void;
};

/**
 * An alert as one row: whether it's on, and a summary of its name, what sets
 * it off, what it plays and what it shows, which opens its editor.
 */
export function AlertItem({
  alert,
  index,
  gifts,
  emotes,
  testing,
  onTest,
  onChange,
  onEdit,
  onRemove,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const { sound, tts, media } = alert;
  const detail = triggerSummary(alert.trigger, gifts, emotes, language);
  const test = alertTest(alert);

  return (
    <div className={styles.row}>
      <Toggle
        aria-label="Enabled"
        checked={alert.enabled}
        onChange={(e) => onChange({ ...alert, enabled: e.target.checked })}
      />

      <button
        type="button"
        className={styles.summary}
        title="Edit alert"
        onClick={onEdit}
      >
        <span className={styles.name}>{alertName(alert.name, index)}</span>

        <span className={styles.part}>
          <span className={styles.trigger}>
            {t(ALERT_TRIGGER_LABELS[alert.trigger.type])}
          </span>
          {detail && (
            <span className={cx(styles.detail, styles.clamp)}>{detail}</span>
          )}
        </span>

        <span className={styles.part}>
          {tts || sound ? (
            <span className={styles.line}>
              {tts ? (
                <FiMessageSquare size={14} aria-hidden />
              ) : (
                <FiMusic size={14} aria-hidden />
              )}
              <span className={styles.text}>
                {tts ? `“${tts.message}”` : sound?.name}
              </span>
            </span>
          ) : (
            <span className={styles.none}>No sound</span>
          )}
          {/* How long it plays, the cut's part of it */}
          {sound && !tts && (
            <span className={styles.detail}>
              <SoundLength file={sound.file} cut={sound} />
            </span>
          )}
        </span>

        <span className={styles.part}>
          {media ? (
            <span className={styles.line}>
              <span className={styles.thumb}>
                <MediaThumbnail file={media.file} />
              </span>
              <span className={styles.media_text}>
                <span className={styles.text}>{media.name}</span>
                <span className={styles.detail}>
                  {formatAdded(media.duration * 1000)}
                </span>
              </span>
            </span>
          ) : (
            <span className={styles.none}>No media</span>
          )}
        </span>

        <FiEdit2 size={16} className={styles.edit} aria-hidden />
      </button>

      {/* Without media its overlay shows nothing. The slot keeps the rows'
          actions lined up. */}
      <span
        className={cx(!media && styles.unused)}
        aria-hidden={!media || undefined}
      >
        <CopyButton
          value={getAlertOverlayURL(alert.id)}
          title="Copy overlay URL"
          disabled={!media}
        />
      </span>
      <PlayButton
        {...testProps(testing, alert.id)}
        size={24}
        disabled={!test}
        onClick={() => test && onTest(test)}
      />
      <Btn variant="icon" title="Remove" onClick={onRemove}>
        <FiTrash2 size={24} />
      </Btn>
    </div>
  );
}
