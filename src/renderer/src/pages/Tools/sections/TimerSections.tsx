import { TimerAction, TimerSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { formatAdded, getOverlayURL, TIMER_PATH } from "@/common/util";
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
import { flushSettings, scopeUpdater, Updater, useAutosave } from "@/hooks";
import homeStyles from "@/pages/Home/home.module.css";
import { rich, useLanguage, useT } from "@/ui/i18n";
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
import { timerStatusText, TimerPush, TRIGGERS } from "../helper";
import styles from "../tools.module.css";
import { TimerPreview } from "./TimerPreview";

interface SectionProps {
  settings: TimerSettings;
  update: Updater<TimerSettings>;
}

/**
 * The countdown timer's sections. Its settings save as they change, while
 * main keeps pushing the clock. The look comes right after the preview, so
 * its changes show while they're made.
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
      <TimerLookSection settings={settings} update={update} />
      <TimeAddedSection settings={settings} update={update} />
    </>
  );
}

// A setting still waiting to save, like the starting time, reaches main first.
const control = (action: TimerAction) => {
  flushSettings();
  window.api.emit(APP_EVENTS.TIMER_CONTROL, { action });
};

function CountdownSection({
  timer,
  settings,
  update,
}: SectionProps & { timer: TimerPush }) {
  const t = useT();
  const language = useLanguage();
  const { state } = timer.data;
  const { status } = state;
  const running = status === "running";
  // Kept while the page is open
  const [minutes, setMinutes] = useState(5);
  const [resetting, setResetting] = useState(false);
  const seconds = Math.round(minutes * 60);
  // In idle the starting time is what to change
  const canAdjust = status !== "idle" && seconds > 0;
  const adjust = (sign: 1 | -1) => {
    // So added time is capped by the cap being typed
    flushSettings();
    window.api.emit(APP_EVENTS.ADJUST_TIMER, { seconds: sign * seconds });
  };

  return (
    <Section
      title={t("tools.countdown.title")}
      description={t("tools.countdown.description")}
    >
      <TimerPreview timer={timer} settings={settings} />

      <div className={styles.timer_bar}>
        <p className={cx(homeStyles.status, running && homeStyles.status_live)}>
          <span
            className={cx(homeStyles.dot, running && homeStyles.dot_live)}
          />
          {timerStatusText(state, language)}
        </p>
        <div className={styles.row}>
          <Btn
            variant="accent"
            disabled={running || state.remaining <= 0}
            onClick={() => control("start")}
          >
            <FiPlay size={16} /> {t("tools.countdown.start")}
          </Btn>
          <Btn disabled={!running} onClick={() => control("pause")}>
            <FiPause size={16} /> {t("common.pause")}
          </Btn>
          <Btn
            disabled={!running && status !== "paused"}
            onClick={() => control("stop")}
          >
            <FiSquare size={16} /> {t("common.stop")}
          </Btn>
          <Btn disabled={status === "idle"} onClick={() => setResetting(true)}>
            <FiRotateCcw size={16} /> {t("common.reset")}
          </Btn>
        </div>
      </div>

      <div className={styles.row}>
        <NumberInput
          className={styles.minutes}
          aria-label={t("tools.countdown.adjust")}
          min={0}
          value={minutes}
          onChange={setMinutes}
        />
        <span className={styles.unit}>{t("tools.countdown.minutes")}</span>
        <Btn disabled={!canAdjust} onClick={() => adjust(-1)}>
          <FiMinus size={16} /> {t("common.remove")}
        </Btn>
        <Btn disabled={!canAdjust} onClick={() => adjust(1)}>
          <FiPlus size={16} /> {t("common.add")}
        </Btn>
      </div>

      <FormGrid>
        <Field
          label={t("tools.countdown.startingTime")}
          hint={t("tools.countdown.startingTimeHint")}
        >
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
        <Field label={t("tools.countdown.url")}>
          <CopyField
            value={getOverlayURL(TIMER_PATH)}
            title={t("tools.countdown.copyUrl")}
          />
        </Field>
      </FormGrid>

      <Check
        label={t("tools.countdown.pauseOnEnd")}
        checked={settings.pause_on_end}
        onChange={(e) =>
          update((s) => {
            s.pause_on_end = e.target.checked;
          })
        }
      />

      {resetting && (
        <Modal
          title={t("tools.countdown.resetTitle")}
          description={t("tools.countdown.resetDescription", {
            time: formatAdded(settings.start * 60_000),
          })}
          confirmText={t("common.reset")}
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

const COLORS = [
  { key: "clock_color", label: "tools.look.clockColor" },
  { key: "title_color", label: "tools.look.titleColor" },
  { key: "accent_color", label: "tools.look.accentColor" },
  { key: "warning_color", label: "tools.look.warningColor" },
] as const;

function TimerLookSection({ settings, update }: SectionProps) {
  const t = useT();
  const { look } = settings;
  const set = scopeUpdater(update, "look");

  return (
    <Section
      title={t("tools.look.title")}
      description={t("tools.look.description")}
    >
      {/* First, as they show the most in the preview above */}
      <div className={styles.colors}>
        {COLORS.map(({ key, label }) => (
          <Field key={key} label={t(label)}>
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

      <FormGrid>
        <Field
          label={t("tools.look.titleField")}
          hint={t("tools.look.titleHint")}
        >
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
        <Field
          label={t("tools.look.warning")}
          hint={t("tools.look.warningHint")}
        >
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
        <Field label={t("tools.look.clockFont")}>
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
        <Field label={t("tools.look.titleFont")}>
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
        <p className={styles.note}>{t("tools.look.fontsNote")}</p>
      </FormGrid>

      <Check
        label={t("tools.look.showMultiplier")}
        checked={look.show_multiplier}
        onChange={(e) =>
          set((l) => {
            l.show_multiplier = e.target.checked;
          })
        }
      />
      <Check
        label={t("tools.look.showTriggers")}
        checked={look.show_triggers}
        onChange={(e) =>
          set((l) => {
            l.show_triggers = e.target.checked;
          })
        }
      />
      {look.show_triggers && (
        <TriggerNames settings={settings} update={update} />
      )}
    </Section>
  );
}

// The names the carousel shows, for the triggers that add time, so they can
// be in the audience's language
function TriggerNames({ settings, update }: SectionProps) {
  const t = useT();
  const { seconds, look } = settings;
  const id = useId();
  // As timerTriggers keeps them, so a multiplier of 0 hides them all
  const shown = TRIGGERS.filter(
    ({ key }) => seconds[key] * settings.multiplier > 0,
  );

  if (shown.length === 0) {
    return <p className={styles.note_plain}>{t("tools.look.noTriggers")}</p>;
  }
  return (
    <ul className={styles.triggers} aria-label={t("tools.look.names")}>
      {shown.map(({ key, label }) => (
        <li key={key} className={styles.trigger}>
          <label htmlFor={`${id}-${key}`} className={styles.trigger_label}>
            {t(label)}
          </label>
          <span className={styles.trigger_rule}>
            {/* Coins and likes show after their count. A column for every
                row, so the fields line up, never empty so the row has a
                baseline for its label. */}
            <span className={styles.count}>
              {key === "coin" ? 1 : key === "likes" ? seconds.likes_every : " "}
            </span>
            <Input
              id={`${id}-${key}`}
              // Apart from the seconds field with the same label
              aria-label={t("tools.look.nameOnStream", { trigger: t(label) })}
              className={styles.name}
              maxLength={40}
              // Blank, the carousel shows the app language's name
              placeholder={t(`timer.names.${key}`)}
              value={look.names[key]}
              onChange={(e) => {
                const name = e.target.value;
                update((s) => {
                  s.look.names[key] = name;
                });
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

function TimeAddedSection({ settings, update }: SectionProps) {
  const t = useT();
  const id = useId();
  const seconds = scopeUpdater(update, "seconds");
  const chat = scopeUpdater(update, "chat");

  return (
    <Section
      title={t("tools.added.title")}
      description={t("tools.added.description")}
    >
      <FormGrid>
        <Field label={t("tools.added.multiplier")} hint="(×)">
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
        <Field label={t("tools.added.cap")} hint={t("tools.added.capHint")}>
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
              {t(label)}
            </label>
            <div className={styles.trigger_rules}>
              <span className={styles.trigger_rule}>
                {rich(t(rule), {
                  input: (
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
                  ),
                  likes: (
                    <NumberInput
                      className={styles.seconds}
                      aria-label={t("tools.added.likesPerCycle")}
                      integer
                      min={1}
                      value={settings.seconds.likes_every}
                      onChange={(value) =>
                        seconds((s) => {
                          s.likes_every = value;
                        })
                      }
                    />
                  ),
                })}
              </span>
              {key === "chat" && (
                <>
                  {/* Matched like chat alerts' keywords */}
                  <Input
                    aria-label={t("tools.added.keyword")}
                    placeholder={t("tools.added.anyMessage")}
                    value={settings.chat.keyword}
                    onChange={(e) => {
                      const keyword = e.target.value;
                      chat((c) => {
                        c.keyword = keyword;
                      });
                    }}
                  />
                  <span className={styles.trigger_rule}>
                    {rich(t("tools.rules.cooldown"), {
                      input: (
                        <NumberInput
                          className={styles.seconds}
                          aria-label={t("tools.added.cooldown")}
                          min={0}
                          value={settings.chat.cooldown}
                          onChange={(cooldown) =>
                            chat((c) => {
                              c.cooldown = cooldown;
                            })
                          }
                        />
                      ),
                    })}
                  </span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
