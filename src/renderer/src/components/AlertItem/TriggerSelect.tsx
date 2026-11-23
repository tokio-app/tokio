import { ALERT_TRIGGERS } from "@/common/schemas";
import { AlertTrigger, Platform } from "@/common/types";
import {
  PLATFORM_LABELS,
  platformsOf,
  triggerName,
  triggersFor,
} from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { Select } from "../Elements";
import styles from "./alertitem.module.css";

type Row = { type: string; platform?: Platform };

const isAlertTrigger = (value: string): value is AlertTrigger =>
  (ALERT_TRIGGERS as readonly string[]).includes(value);

/**
 * The events of values a row on platform can pick: the ones it sends (any
 * of the profile's without one), and the editor's own that come from no
 * platform, like Studio's Goal. Music change only on Any platform.
 */
export function eventsFor<V extends string>(
  values: readonly V[],
  platforms: readonly Platform[],
  platform?: Platform,
): V[] {
  const sent = triggersFor(platform ? [platform] : platforms);
  return values.filter(
    (value) =>
      !isAlertTrigger(value) ||
      (sent.includes(value) && (!platform || platformsOf(value).length > 0)),
  );
}

/**
 * The row on platform, the key left out for any (so an autosave's echo
 * equals it), moved to the first of events when it isn't one of them.
 */
export function withPlatform<T extends Row>(
  row: T,
  platform: Platform | undefined,
  events: readonly T["type"][],
  retype: (row: T, type: T["type"]) => T = (r, type) => ({ ...r, type }),
): T {
  const next = { ...row };
  if (platform) next.platform = platform;
  else delete next.platform;
  return events.includes(row.type) || events.length === 0
    ? next
    : retype(next, events[0]);
}

type Props<T extends Row> = {
  trigger: T;
  // The editor's events, translated
  options: { value: T["type"]; label: string }[];
  "aria-label": string;
  className?: string;
  // How the row takes another event, its type alone by default
  retype?: (trigger: T, type: T["type"]) => T;
  onChange: (trigger: T) => void;
};

/**
 * A trigger's event, after its platform when the profile uses two or more
 * (or the row has one saved). The events follow the platform picked.
 */
export function TriggerSelect<T extends Row>({
  trigger,
  options,
  "aria-label": label,
  className,
  retype = (r, type) => ({ ...r, type }),
  onChange,
}: Props<T>) {
  const t = useT();
  const platforms = usePlatforms();
  const values = options.map((o) => o.value);
  const events = eventsFor(values, platforms, trigger.platform);
  // Named as the row's platform names them: a Kick row's gifts are Kicks
  const shown = options
    .filter((o) => events.includes(o.value) || o.value === trigger.type)
    .map((o) =>
      isAlertTrigger(o.value)
        ? {
            ...o,
            label: t(
              triggerName({ type: o.value, platform: trigger.platform }),
            ),
          }
        : o,
    );
  const event = (eventClass?: string) => (
    <Select
      className={eventClass}
      aria-label={label}
      options={shown}
      value={trigger.type}
      onChange={(type) => onChange(retype(trigger, type))}
    />
  );
  // A Studio goal comes from no platform
  const pickPlatform =
    isAlertTrigger(trigger.type) &&
    (platforms.length > 1 || trigger.platform !== undefined);
  if (!pickPlatform) {
    return event(className);
  }

  // The profile's, and one saved that it no longer uses
  const picks = [
    ...platforms,
    ...(trigger.platform && !platforms.includes(trigger.platform)
      ? [trigger.platform]
      : []),
  ];
  return (
    <div className={cx(styles.pick, className)}>
      <Select
        aria-label={t("components.triggers.platform")}
        options={[
          { value: "", label: t("components.triggers.anyPlatform") },
          ...picks.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
        ]}
        value={trigger.platform ?? ""}
        onChange={(picked) => {
          const platform = picked === "" ? undefined : picked;
          onChange(
            withPlatform(
              trigger,
              platform,
              eventsFor(values, platforms, platform),
              retype,
            ),
          );
        }}
      />
      {event()}
    </div>
  );
}
