import { TimerSettings } from "@/common/schemas";
import { formatAdded, timerTriggers } from "@/common/util";
import { fontFamily, formatDuration } from "@/helper";
import { useLanguage } from "@/ui/i18n";
import { useEffect, useState } from "react";
import { TimerPush } from "../helper";
import styles from "../tools.module.css";

// How long added time shows under the clock, as the overlay's animation
const SLOT_MS = 1500;
// How long the carousel shows each trigger, as the overlay's TURN_MS
const TURN_MS = 3000;

interface Props {
  timer: TimerPush;
  // As edited, so the preview follows them before they're saved
  settings: TimerSettings;
}

/**
 * The timer as the overlay shows it on stream. It counts down on its own
 * between main's pushes, ticking only while the timer runs.
 */
export function TimerPreview({ timer, settings }: Props) {
  const language = useLanguage();
  const { state, added } = timer.data;
  const { look } = settings;
  const running = state.status === "running";
  const [now, setNow] = useState(timer.at);
  // The time added or removed while it shows, summed like the overlay's
  const [slot, setSlot] = useState<{ ms: number; key: number } | null>(null);
  const [prevTimer, setPrevTimer] = useState(timer);

  if (timer !== prevTimer) {
    setPrevTimer(timer);
    if (added !== 0) {
      setSlot((s) => ({ ms: (s?.ms ?? 0) + added, key: (s?.key ?? 0) + 1 }));
    }
  }

  useEffect(() => {
    if (!running) return undefined;
    const tick = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(tick);
  }, [running]);

  // Each change shows it again for the whole animation
  useEffect(() => {
    if (!slot) return undefined;
    const hide = setTimeout(() => setSlot(null), SLOT_MS);
    return () => clearTimeout(hide);
  }, [slot]);

  // The carousel turns while it has more than one trigger
  const triggers = look.show_triggers ? timerTriggers(settings, language) : [];
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (triggers.length < 2) return undefined;
    const next = setInterval(() => setTurn((t) => t + 1), TURN_MS);
    return () => clearInterval(next);
  }, [triggers.length]);
  const index = triggers.length > 0 ? turn % triggers.length : 0;
  const trigger = triggers[index];

  // Idle follows the starting time being typed, before main's echo
  const remaining =
    state.status === "idle"
      ? settings.start * 60_000
      : running
        ? Math.max(0, state.remaining - Math.max(0, now - timer.at))
        : state.remaining;
  const warning =
    running && look.warn_at > 0 && remaining <= look.warn_at * 60_000;
  const title = look.title.trim();
  // Under a second rounds to nothing, as on the overlay
  const shown = slot && Math.round(Math.abs(slot.ms) / 1000) >= 1 ? slot : null;
  const clockFont = fontFamily(look.clock_font);

  return (
    <div className={styles.preview}>
      {title && (
        <p
          className={styles.preview_title}
          style={{
            color: look.title_color,
            fontFamily: fontFamily(look.title_font),
          }}
        >
          {title}
        </p>
      )}
      <span
        role="timer"
        className={styles.clock}
        style={{
          color: warning ? look.warning_color : look.clock_color,
          fontFamily: clockFont,
        }}
      >
        {/* Rounded up, so 00:00:00 shows only at the end */}
        {formatDuration(Math.ceil(remaining / 1000) * 1000)}
      </span>
      <span className={styles.slot} style={{ fontFamily: clockFont }}>
        {shown ? (
          <span
            key={shown.key}
            className={styles.slot_added}
            style={{
              color: shown.ms > 0 ? look.accent_color : look.clock_color,
            }}
          >
            {shown.ms > 0 ? "+" : "−"}
            {formatAdded(shown.ms)}
          </span>
        ) : (
          look.show_multiplier &&
          settings.multiplier !== 1 && (
            <span style={{ color: look.accent_color }}>
              ×{+settings.multiplier.toFixed(2)}
            </span>
          )
        )}
      </span>
      {trigger && (
        <p
          className={styles.carousel}
          style={{
            color: look.title_color,
            fontFamily: fontFamily(look.title_font),
          }}
        >
          {/* A new key per turn replays the overlay's entrance */}
          <span key={index} className={styles.carousel_item}>
            {trigger.label}
            <b style={{ color: look.accent_color }}>{trigger.value}</b>
          </span>
        </p>
      )}
    </div>
  );
}
