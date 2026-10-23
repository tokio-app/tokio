import { TimerAction, TimerSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { getOverlayURL, TIMER_PATH } from "@/common/util";
import {
  Btn,
  Check,
  Color,
  CopyField,
  Field,
  FormGrid,
  Input,
  Modal,
  NumberInput,
  Section,
} from "@/components";
import { cx } from "@/helper";
import { scopeUpdater, Updater, useAutosave } from "@/hooks";
import homeStyles from "@/pages/Home/home.module.css";
import { produce } from "immer";
import { useId, useState } from "react";
import {
  FiMinus,
  FiPause,
  FiPlay,
  FiPlus,
  FiRotateCcw,
  FiSquare,
} from "react-icons/fi";
import { shortDuration, timerStatusText, TimerPush, TRIGGERS } from "../helper";
import styles from "../tools.module.css";
import { TimerPreview } from "./TimerPreview";

interface SectionProps {
  settings: TimerSettings;
  update: Updater<TimerSettings>;
}

/**
 * The countdown timer's sections. Its settings save as they change, while
 * main keeps pushing the clock.
 */
export function TimerSections({ timer }: { timer: TimerPush }) {
  const [settings, setSettings] = useAutosave(timer.data.settings, (value) =>
    window.api.emit(APP_EVENTS.SET_TIMER_SETTINGS, { settings: value }),
  );
  const update: Updater<TimerSettings> = (recipe) =>
    setSettings((s) => produce<TimerSettings, TimerSettings>(s, recipe));

  return (
    <>
      <CountdownSection timer={timer} settings={settings} update={update} />
      <TimeAddedSection settings={settings} update={update} />
      <TimerLookSection settings={settings} update={update} />
    </>
  );
}

const control = (action: TimerAction) =>
  window.api.emit(APP_EVENTS.TIMER_CONTROL, { action });

function CountdownSection({
  timer,
  settings,
  update,
}: SectionProps & { timer: TimerPush }) {
  const { state } = timer.data;
  const { status } = state;
  const running = status === "running";
  // Kept while the page is open
  const [minutes, setMinutes] = useState(5);
  const [resetting, setResetting] = useState(false);
  const seconds = Math.round(minutes * 60);
  // In idle the starting time is what to change
  const canAdjust = status !== "idle" && seconds > 0;
  const adjust = (sign: 1 | -1) =>
    window.api.emit(APP_EVENTS.ADJUST_TIMER, { seconds: sign * seconds });

  return (
    <Section
      title="Countdown Timer"
      description="A countdown viewers add time to."
    >
      <TimerPreview timer={timer} settings={settings} />

      <div className={styles.timer_bar}>
        <p className={cx(homeStyles.status, running && homeStyles.status_live)}>
          <span
            className={cx(homeStyles.dot, running && homeStyles.dot_live)}
          />
          {timerStatusText(state)}
        </p>
        <div className={styles.row}>
          <Btn
            variant="accent"
            disabled={running || state.remaining <= 0}
            onClick={() => control("start")}
          >
            <FiPlay size={16} /> Start
          </Btn>
          <Btn disabled={!running} onClick={() => control("pause")}>
            <FiPause size={16} /> Pause
          </Btn>
          <Btn
            disabled={!running && status !== "paused"}
            onClick={() => control("stop")}
          >
            <FiSquare size={16} /> Stop
          </Btn>
          <Btn disabled={status === "idle"} onClick={() => setResetting(true)}>
            <FiRotateCcw size={16} /> Reset
          </Btn>
        </div>
      </div>

      <div className={styles.row}>
        <NumberInput
          className={styles.minutes}
          aria-label="Minutes to add or remove"
          min={0}
          value={minutes}
          onChange={setMinutes}
        />
        <span className={styles.unit}>minutes</span>
        <Btn disabled={!canAdjust} onClick={() => adjust(-1)}>
          <FiMinus size={16} /> Remove
        </Btn>
        <Btn disabled={!canAdjust} onClick={() => adjust(1)}>
          <FiPlus size={16} /> Add
        </Btn>
      </div>

      <FormGrid>
        <Field label="Starting time" hint="(minutes)">
          <NumberInput
            integer
            min={1}
            value={settings.start}
            onChange={(start) =>
              update((s) => {
                s.start = start;
              })
            }
          />
        </Field>
        <Field label="Overlay URL">
          <CopyField
            value={getOverlayURL(TIMER_PATH)}
            title="Copy the timer's URL"
          />
        </Field>
      </FormGrid>

      <Check
        label="Pause when the LIVE ends or disconnects"
        checked={settings.pause_on_end}
        onChange={(e) =>
          update((s) => {
            s.pause_on_end = e.target.checked;
          })
        }
      />

      {resetting && (
        <Modal
          title="Reset the timer?"
          description={`It goes back to the starting time, ${shortDuration(settings.start * 60_000)}. The time added so far is lost.`}
          confirmText="Reset"
          onClose={() => setResetting(false)}
          onConfirm={() => {
            control("reset");
            setResetting(false);
          }}
        />
      )}
    </Section>
  );
}

function TimeAddedSection({ settings, update }: SectionProps) {
  const id = useId();
  const seconds = scopeUpdater(update, "seconds");

  return (
    <Section title="Time Added" description="Seconds per trigger.">
      <FormGrid>
        <Field label="Multiplier" hint="(×)">
          <NumberInput
            min={0}
            value={settings.multiplier}
            onChange={(multiplier) =>
              update((s) => {
                s.multiplier = multiplier;
              })
            }
          />
        </Field>
        <Field label="Per-viewer cooldown" hint="(seconds)">
          <NumberInput
            min={0}
            value={settings.cooldown}
            onChange={(cooldown) =>
              update((s) => {
                s.cooldown = cooldown;
              })
            }
          />
        </Field>
        <Field label="Maximum time" hint="(minutes, 0 = no limit)">
          <NumberInput
            min={0}
            value={settings.cap}
            onChange={(cap) =>
              update((s) => {
                s.cap = cap;
              })
            }
          />
        </Field>
      </FormGrid>

      <ul className={styles.triggers}>
        {TRIGGERS.map(({ key, label, rule }) => (
          <li key={key} className={styles.trigger}>
            <label htmlFor={`${id}-${key}`} className={styles.trigger_label}>
              {label}
            </label>
            <span className={styles.trigger_rule}>
              <NumberInput
                id={`${id}-${key}`}
                className={styles.seconds}
                min={0}
                value={settings.seconds[key]}
                onChange={(value) =>
                  seconds((s) => {
                    s[key] = value;
                  })
                }
              />
              {rule}
              {key === "likes" && (
                <>
                  <NumberInput
                    className={styles.seconds}
                    aria-label="Likes per cycle"
                    integer
                    min={1}
                    value={settings.seconds.likes_every}
                    onChange={(value) =>
                      seconds((s) => {
                        s.likes_every = value;
                      })
                    }
                  />
                  likes
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const COLORS = [
  { key: "clock_color", label: "Clock" },
  { key: "title_color", label: "Title" },
  { key: "accent_color", label: "Added time" },
  { key: "warning_color", label: "Warning" },
] as const;

function TimerLookSection({ settings, update }: SectionProps) {
  const { look } = settings;
  const set = scopeUpdater(update, "look");

  return (
    <Section title="Timer Look" description="How it shows on stream.">
      <FormGrid>
        <Field label="Title" hint="(optional)">
          <Input
            maxLength={60}
            value={look.title}
            onChange={(e) => {
              const title = e.target.value;
              set((l) => {
                l.title = title;
              });
            }}
          />
        </Field>
        <Field label="Warning" hint="(minutes before the end, 0 = off)">
          <NumberInput
            min={0}
            value={look.warn_at}
            onChange={(warnAt) =>
              set((l) => {
                l.warn_at = warnAt;
              })
            }
          />
        </Field>
        <Field label="Clock font">
          <Input
            maxLength={60}
            placeholder="Archivo"
            value={look.clock_font}
            onChange={(e) => {
              const font = e.target.value;
              set((l) => {
                l.clock_font = font;
              });
            }}
          />
        </Field>
        <Field label="Title font">
          <Input
            maxLength={60}
            placeholder="Archivo"
            value={look.title_font}
            onChange={(e) => {
              const font = e.target.value;
              set((l) => {
                l.title_font = font;
              });
            }}
          />
        </Field>
        <p className={styles.note}>
          Fonts installed on the computer with your streaming app.
        </p>
      </FormGrid>

      <div className={styles.colors}>
        {COLORS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <Color
              value={look[key]}
              onChange={(color) =>
                set((l) => {
                  l[key] = color;
                })
              }
            />
          </Field>
        ))}
      </div>

      <Check
        label="Show the multiplier"
        checked={look.show_multiplier}
        onChange={(e) =>
          set((l) => {
            l.show_multiplier = e.target.checked;
          })
        }
      />
    </Section>
  );
}
