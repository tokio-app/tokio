import { MessageKey } from "@/common/i18n";
import { Trigger } from "@/common/schemas";
import { Platform, TOKIO_EVENTS } from "@/common/types";
import { giftCurrencies, rowStreaks } from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { rich, useT } from "@/ui/i18n";
import { NumberInput } from "../Elements";
import { Field } from "../Page";
import styles from "./alertitem.module.css";

export type MinUnit = "coins" | "kicks" | "either" | "bits" | "usd" | "subs";

/**
 * What a row's minimum (min_coins) is in: Bits for Bits, US dollars for
 * Super Chats, subs for gifted subs, and for a gift its platform's currency,
 * or for any platform the profile's, "either" with both. Null for other
 * events and gifts without a price (YouTube's), unless a gift minimum is
 * saved, so it stays to fix.
 */
export function minUnit(
  trigger: Trigger,
  profilePlatforms: readonly Platform[],
): MinUnit | null {
  if (trigger.type === TOKIO_EVENTS.CHEER) return "bits";
  if (trigger.type === TOKIO_EVENTS.SUPER_CHAT) return "usd";
  if (trigger.type === TOKIO_EVENTS.GIFT_SUB) return "subs";
  if (trigger.type !== TOKIO_EVENTS.GIFT) return null;
  const currencies = giftCurrencies(
    trigger.platform ? [trigger.platform] : profilePlatforms,
  );
  if (currencies.length > 1) return "either";
  return currencies[0] ?? (trigger.min_coins > 0 ? "coins" : null);
}

// The minimum's input in its unit: "{input} coins"
const MIN_INPUT: Record<MinUnit, MessageKey> = {
  coins: "alerts.editor.minCoinsInput",
  kicks: "alerts.editor.minKicksInput",
  either: "alerts.editor.minEitherInput",
  bits: "alerts.editor.minBitsInput",
  usd: "alerts.editor.minUsdInput",
  subs: "alerts.editor.minSubsInput",
};

type Props = {
  trigger: Trigger;
  onChange: (trigger: Trigger) => void;
};

/**
 * A row's minimum in its event's unit: "Worth at least 100 Bits", "At least
 * 5 gifted subs". None for an event without one, or for picked gifts, which
 * are the row's choice already. Alerts and Overlay Studio's reactions share
 * it; game actions have none.
 */
export function MinimumField({ trigger, onChange }: Props) {
  const t = useT();
  const platforms = usePlatforms();
  const unit = minUnit(trigger, platforms);
  const gift = trigger.type === TOKIO_EVENTS.GIFT;
  if (!unit || (gift && trigger.gifts.length > 0)) return null;
  const label = t(
    unit === "subs" ? "alerts.editor.atLeast" : "alerts.editor.minCoins",
  );

  return (
    <Field label={label}>
      <span className={styles.minimum}>
        {rich(t(MIN_INPUT[unit]), {
          input: (
            <NumberInput
              integer
              min={0}
              className={styles.minimum_input}
              aria-label={label}
              value={trigger.min_coins}
              onChange={(min_coins) => onChange({ ...trigger, min_coins })}
            />
          ),
        })}
      </span>
      {gift && rowStreaks(trigger, platforms) && (
        <p className={styles.minimum_note}>
          {t(
            trigger.every_gift
              ? "alerts.editor.everyGiftNote"
              : "alerts.editor.streakNote",
          )}
        </p>
      )}
    </Field>
  );
}
