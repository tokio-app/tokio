import { listOf, MessageKey, Params, translate } from "@/common/i18n";
import { Alert, ALERT_TRIGGERS, Trigger } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  Platform,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  alertName,
  formatAdded,
  getAlertOverlayURL,
  giftNames,
  idPlatform,
  PLATFORM_LABELS,
  roleName,
  rowPlatforms,
  rowStreaks,
  takesRoles,
  triggersOf,
} from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { cx } from "@/helper/cx";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useLanguage, useOptions, useT } from "@/ui/i18n";
import { FiEdit2, FiMessageSquare, FiMusic, FiTrash2 } from "react-icons/fi";
import { CopyButton } from "../CopyField";
import { Btn, Input, Select, Toggle } from "../Elements";
import { EmoteMultiSelect, EmoteOption } from "../EmoteSelect";
import { GiftMultiSelect } from "../GiftSelect";
import { MediaThumbnail } from "../MediaPicker";
import { PlayButton, TestState, testProps } from "../PlayButton";
import { SoundLength } from "../SoundPicker/SoundLength";
import styles from "./alertitem.module.css";
import { minUnit, type MinUnit } from "./MinimumField";

export { MinimumField, minUnit } from "./MinimumField";
export { TriggerRows, type TriggerRow } from "./TriggerRows";
export { TriggerSelect } from "./TriggerSelect";

// The triggers, their labels keys (see useOptions)
export const TRIGGER_OPTIONS: { value: Trigger["type"]; label: MessageKey }[] =
  ALERT_TRIGGERS.map((value) => ({
    value,
    label: ALERT_TRIGGER_LABELS[value],
  }));

// When a gift alert plays, see every_gift
const GIFT_PLAYS: { value: "streak" | "gift"; label: MessageKey }[] = [
  { value: "streak", label: "components.alertItem.playsStreak" },
  { value: "gift", label: "components.alertItem.playsGift" },
];

// As the summary names them, keys translated where they show
const WORTH: Record<MinUnit, MessageKey> = {
  coins: "components.alertItem.worth",
  kicks: "components.alertItem.worthKicks",
  bits: "components.alertItem.worthBits",
  usd: "components.alertItem.worthUsd",
  subs: "components.alertItem.giftSubsAtLeast",
};

// "worth 100+ Bits", "worth $5+", "5+ gifted subs". A minimum is whole, so
// its dollars have no cents.
const worthText = (
  unit: MinUnit,
  min: number,
  language: string,
  t: (key: MessageKey, params?: Params) => string,
) =>
  t(
    WORTH[unit],
    unit === "usd"
      ? {
          amount: new Intl.NumberFormat(language, {
            style: "currency",
            currency: "USD",
            trailingZeroDisplay: "stripIfInteger",
          }).format(min),
        }
      : { count: min },
  );

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
  const t = useT();
  const plays = useOptions(GIFT_PLAYS);
  const platforms = usePlatforms();
  const streaks = rowStreaks(trigger, platforms);
  // TikTok's catalog, for rows its gifts can set off. Picks stay to clear.
  const catalog = streaks || trigger.gifts.length > 0;
  switch (trigger.type) {
    case TOKIO_EVENTS.GIFT:
      // YouTube's gifts have neither
      if (!catalog && !streaks) return null;
      return (
        <div className={styles.stack}>
          {catalog && (
            <GiftMultiSelect
              placeholder={t("common.anyGift")}
              gifts={gifts}
              value={trigger.gifts}
              onChange={(ids) => onChange({ ...trigger, gifts: ids })}
            />
          )}
          {streaks && (
            <Select
              className={styles.fill}
              aria-label={t("components.alertItem.whenItPlays")}
              options={plays}
              value={trigger.every_gift ? "gift" : "streak"}
              onChange={(play) =>
                onChange({ ...trigger, every_gift: play === "gift" })
              }
            />
          )}
        </div>
      );
    case EMOTE_TRIGGER: {
      // The row's platforms' emotes. Picks stay to clear.
      const covered = rowPlatforms(trigger, platforms);
      const shown = emotes.filter(
        (emote) =>
          covered.includes(idPlatform(emote.value)) ||
          trigger.emotes.includes(emote.value),
      );
      return (
        <EmoteMultiSelect
          placeholder={t("components.alertItem.anyEmote")}
          emotes={shown}
          value={trigger.emotes}
          onChange={(ids) => onChange({ ...trigger, emotes: ids })}
        />
      );
    }
    case TOKIO_EVENTS.CHAT:
      return (
        <Input
          className={styles.fill}
          placeholder={t("common.anyMessage")}
          value={trigger.keyword}
          onChange={(e) => onChange({ ...trigger, keyword: e.target.value })}
        />
      );
    // The reward's title, matched as chat's keyword
    case TOKIO_EVENTS.REDEEM:
      return (
        <Input
          className={styles.fill}
          placeholder={t("components.alertItem.anyReward")}
          value={trigger.keyword}
          onChange={(e) => onChange({ ...trigger, keyword: e.target.value })}
        />
      );
    case TOKIO_EVENTS.MEMBER_JOIN:
    case TOKIO_EVENTS.SUPER_FAN_JOIN:
      return (
        <Input
          className={styles.fill}
          placeholder={t("components.alertItem.anyone")}
          title={t("components.alertItem.userTitle")}
          value={trigger.user}
          onChange={(e) => onChange({ ...trigger, user: e.target.value })}
        />
      );
    default:
      return null;
  }
}

// The most gifts or emotes a summary names or shows, the rest counted
const NAMED = 3;

// Between the triggers' conditions: each can hold commas and "or" already,
// so another "or" would blur which goes with which
const ROWS = " · ";

const capitalize = (text: string, language: string) =>
  text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

// The gifts or emotes picked, as the summary names them, null while the
// lists don't have any of them
function pickedNames(
  trigger: Trigger,
  gifts: CustomGift[],
  emotes: EmoteOption[],
  language: string,
): string | null {
  if (trigger.type === TOKIO_EVENTS.GIFT) {
    return giftNames(trigger.gifts, gifts, language, NAMED);
  }
  const names = trigger.emotes.flatMap(
    (id) => emotes.find((emote) => emote.value === id)?.label ?? [],
  );
  return names.length > 0
    ? listOf(language, names, { type: "or", max: NAMED })
    : null;
}

// The pictures of a trigger's picked gifts or emotes, undefined for one the
// lists have none of
const pictureList = (
  trigger: Trigger,
  gifts: CustomGift[],
  emotes: EmoteOption[],
) =>
  trigger.type === TOKIO_EVENTS.GIFT
    ? trigger.gifts.map((id) => gifts.find((gift) => gift.value === id)?.img)
    : trigger.type === EMOTE_TRIGGER
      ? trigger.emotes.map(
          (id) => emotes.find((emote) => emote.value === id)?.img,
        )
      : [];

/**
 * The pictures of the gifts or emotes picked by any of the triggers, at most
 * NAMED, and how many more are picked. Null when the lists have none of their
 * pictures, so the summary names them instead.
 */
function triggerPictures(
  triggers: Trigger[],
  gifts: CustomGift[],
  emotes: EmoteOption[],
): { shown: string[]; more: number } | null {
  const pictures = triggers.flatMap((trigger) =>
    pictureList(trigger, gifts, emotes),
  );
  const shown = pictures.filter((img): img is string => !!img).slice(0, NAMED);
  // The rest counts the ones without a picture too, the trigger reacts to them
  return shown.length > 0
    ? { shown, more: pictures.length - shown.length }
    : null;
}

/**
 * What narrows a trigger, in the language: "Rose or Lion, when the streak
 * ends, worth 100+ coins, from Followers". Empty when nothing does. Pictured
 * leaves out the gifts or emotes, which their pictures show.
 */
function rowSummary(
  trigger: Trigger,
  gifts: CustomGift[],
  emotes: EmoteOption[],
  language: string,
  pictured: boolean,
  platforms: readonly Platform[],
): string {
  const t = (key: MessageKey, params?: Params) =>
    translate(language, key, params);
  const parts: string[] = [];
  const unit = minUnit(trigger, platforms);
  switch (trigger.type) {
    case TOKIO_EVENTS.GIFT:
      if (!pictured) {
        parts.push(
          trigger.gifts.length === 0
            ? t("common.anyGift")
            : // Gifts the lists don't have yet, until they load
              (pickedNames(trigger, gifts, emotes, language) ??
                t("components.alertItem.someGifts")),
        );
      }
      // YouTube's gifts come one at a time
      if (rowStreaks(trigger, platforms)) {
        parts.push(
          trigger.every_gift
            ? t("components.alertItem.everyGift")
            : t("components.alertItem.streakEnds"),
        );
      }
      // Only any gift has a worth to reach
      if (trigger.gifts.length === 0 && trigger.min_coins > 0 && unit) {
        parts.push(worthText(unit, trigger.min_coins, language, t));
      }
      break;
    case TOKIO_EVENTS.CHEER:
    case TOKIO_EVENTS.KICKS:
    case TOKIO_EVENTS.SUPER_CHAT:
    case TOKIO_EVENTS.GIFT_SUB:
      if (trigger.min_coins > 0 && unit) {
        parts.push(worthText(unit, trigger.min_coins, language, t));
      }
      break;
    case EMOTE_TRIGGER:
      if (!pictured) {
        parts.push(
          pickedNames(trigger, gifts, emotes, language) ??
            t("components.alertItem.anyEmote"),
        );
      }
      break;
    case TOKIO_EVENTS.CHAT: {
      const keyword = trigger.keyword.trim();
      parts.push(
        keyword
          ? t("components.alertItem.keyword", { keyword })
          : t("common.anyMessage"),
      );
      break;
    }
    case TOKIO_EVENTS.REDEEM: {
      const reward = trigger.keyword.trim();
      parts.push(
        reward
          ? t("components.alertItem.reward", { reward })
          : t("components.alertItem.anyReward"),
      );
      break;
    }
    case TOKIO_EVENTS.MEMBER_JOIN:
    case TOKIO_EVENTS.SUPER_FAN_JOIN: {
      const user = trigger.user.trim();
      parts.push(
        user
          ? t("components.alertItem.onlyUser", { user })
          : t("components.alertItem.anyone"),
      );
      break;
    }
  }
  if (takesRoles(trigger.type) && trigger.roles.length > 0) {
    const roles = listOf(
      language,
      trigger.roles.map((role) => roleName(role, trigger, platforms, language)),
      { type: "or" },
    );
    parts.push(t("components.alertItem.fromRoles", { roles }));
  }
  return parts.join(", ");
}

/**
 * What narrows the triggers, in the language: each trigger's conditions, as
 * a clause of their own (ROWS between them). Empty when nothing does.
 * Pictured leaves out the gifts and emotes of a trigger whose pictures show.
 * The profile's platforms name a minimum's unit on rows for any platform.
 */
export function triggerSummary(
  triggers: Trigger[],
  gifts: CustomGift[],
  emotes: EmoteOption[],
  language: string,
  pictured = false,
  platforms: readonly Platform[] = ["tiktok"],
): string {
  const rows = triggers
    .map((trigger) =>
      rowSummary(
        trigger,
        gifts,
        emotes,
        language,
        pictured && pictureList(trigger, gifts, emotes).some(Boolean),
        platforms,
      ),
    )
    .filter(Boolean);
  return rows.map((row) => capitalize(row, language)).join(ROWS);
}

/**
 * A trigger's event as rows name it, with its platform when it has one:
 * "Follow on Twitch", "Kicks on Kick".
 */
export function eventName(
  { type, platform }: { type: Trigger["type"]; platform?: Platform },
  t: (key: MessageKey, params?: Params) => string,
): string {
  const event = t(ALERT_TRIGGER_LABELS[type]);
  return platform
    ? t("components.triggers.onPlatform", {
        event,
        platform: PLATFORM_LABELS[platform],
      })
    : event;
}

/**
 * The events that set the alert off, said once each and joined as the
 * language joins alternatives: "Follow or Gift".
 */
export function triggerLabel(
  alert: Pick<Alert, "trigger" | "also_triggers">,
  t: (key: MessageKey, params?: Params) => string,
  language: string,
): string {
  const names = triggersOf(alert).map((trigger) => eventName(trigger, t));
  return listOf(language, [...new Set(names)], { type: "or" });
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
  const triggers = triggersOf(alert);
  const pictures = triggerPictures(triggers, gifts, emotes);
  const platforms = usePlatforms();
  const detail = triggerSummary(
    triggers,
    gifts,
    emotes,
    language,
    !!pictures,
    platforms,
  );
  // What the pictures show, for screen readers and on hover
  const names = pictures
    ? triggers
        .flatMap((trigger) =>
          pictureList(trigger, gifts, emotes).some(Boolean)
            ? (pickedNames(trigger, gifts, emotes, language) ?? [])
            : [],
        )
        .join(ROWS) || undefined
    : undefined;
  const test = alertTest(alert);

  return (
    <div className={cx(styles.row, !alert.enabled && styles.off)}>
      <Toggle
        aria-label={t("common.enabled")}
        checked={alert.enabled}
        onChange={(e) => onChange({ ...alert, enabled: e.target.checked })}
      />

      <button
        type="button"
        className={styles.summary}
        title={t("components.alertItem.edit")}
        onClick={onEdit}
      >
        <span className={styles.part}>
          <span className={styles.name}>{alertName(alert.name, index)}</span>
          <span className={styles.trigger}>
            <span className={styles.event}>
              {triggerLabel(alert, t, language)}
            </span>
            {pictures && (
              <span
                role="img"
                aria-label={names}
                title={names}
                className={styles.pictures}
              >
                {pictures.shown.map((src, i) => (
                  <img key={i} src={src} alt="" />
                ))}
                {pictures.more > 0 && (
                  <span className={styles.more}>
                    {t("components.alertItem.morePictures", {
                      count: pictures.more,
                    })}
                  </span>
                )}
              </span>
            )}
            {detail && <span className={styles.conditions}>{detail}</span>}
          </span>
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
                {tts
                  ? t("common.quotedMessage", {
                      message: tts.message,
                    })
                  : sound?.name}
              </span>
            </span>
          ) : (
            <span className={styles.none}>
              {t("components.alertItem.noSound")}
            </span>
          )}
          {/* How long it plays, the cut's part of it */}
          {sound && !tts && (
            <span className={styles.detail}>
              <SoundLength key={sound.file} file={sound.file} cut={sound} />
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
            <span className={styles.none}>
              {t("components.alertItem.noMedia")}
            </span>
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
          title={t("components.alertItem.copyUrl")}
          disabled={!media}
        />
      </span>
      <PlayButton
        {...testProps(testing, alert.id)}
        disabled={!test}
        onClick={() => test && onTest(test)}
      />
      <Btn variant="icon" title={t("common.remove")} onClick={onRemove}>
        <FiTrash2 size={20} />
      </Btn>
    </div>
  );
}
