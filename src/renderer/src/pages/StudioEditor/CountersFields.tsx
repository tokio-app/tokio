import {
  STUDIO_COUNTER_NAME_MAX_LENGTH,
  STUDIO_MAX_COUNTERS,
  StudioCounter,
  TriggerSchema,
} from "@/common/schemas";
import { CustomGift, TOKIO_EVENTS } from "@/common/types";
import {
  Btn,
  EmoteOption,
  Input,
  TRIGGER_OPTIONS,
  TriggerFilter,
  TriggerSelect,
} from "@/components";
import { useOptions, useT } from "@/ui/i18n";
import { useId } from "react";
import { FiAlertTriangle, FiPlus, FiX } from "react-icons/fi";
import { counterWarning } from "./helper";
import styles from "./studioeditor.module.css";

type Props = {
  counters: StudioCounter[];
  gifts: CustomGift[];
  emotes: EmoteOption[];
  onChange: (counters: StudioCounter[]) => void;
};

// What a new counter counts, the schema's default
const newCounter = (): StudioCounter => ({
  name: "",
  trigger: TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] }),
});

/**
 * The overlay's counters, each a name its texts show as {name} and the
 * trigger it counts during the LIVE. A name that can't work is warned
 * about, never refused: main would refuse every autosave while it's typed.
 */
export function CountersFields({ counters, gifts, emotes, onChange }: Props) {
  const t = useT();
  const title = useId();
  const triggers = useOptions(TRIGGER_OPTIONS);
  const set = (index: number, changed: StudioCounter) =>
    onChange(counters.map((c, i) => (i === index ? changed : c)));

  return (
    <div className={styles.titled} role="group" aria-labelledby={title}>
      <span id={title} className={styles.titled_name}>
        {t("studio.counters.title")}
      </span>
      {counters.length === 0 ? (
        <p className={styles.note}>{t("studio.counters.empty")}</p>
      ) : (
        <ul className={styles.counter_list}>
          {counters.map((counter, index) => {
            const number = String(index + 1);
            const remove = t("studio.counters.remove", { number });
            const warning = counterWarning(counters, index);
            const warningId = `${title}-${index}`;
            const { trigger } = counter;
            return (
              <li
                key={index}
                className={styles.counter_row}
                role="group"
                aria-label={t("studio.counters.row", { number })}
              >
                <div className={styles.counter_head}>
                  <span className={styles.counter_name}>
                    <span aria-hidden>{"{"}</span>
                    <Input
                      aria-label={t("common.name")}
                      aria-describedby={warning ? warningId : undefined}
                      maxLength={STUDIO_COUNTER_NAME_MAX_LENGTH}
                      value={counter.name}
                      onChange={(e) =>
                        set(index, {
                          ...counter,
                          // Only what {name} finds in a text
                          name: e.target.value
                            .replace(/\W/g, "")
                            .slice(0, STUDIO_COUNTER_NAME_MAX_LENGTH),
                        })
                      }
                    />
                    <span aria-hidden>{"}"}</span>
                  </span>
                  <Btn
                    variant="icon"
                    title={remove}
                    aria-label={remove}
                    onClick={() =>
                      onChange(counters.filter((_, i) => i !== index))
                    }
                  >
                    <FiX size={16} />
                  </Btn>
                </div>
                {warning && (
                  <p id={warningId} className={styles.counter_warning}>
                    <FiAlertTriangle size={14} aria-hidden />
                    {t(warning)}
                  </p>
                )}
                <TriggerSelect
                  aria-label={t("studio.counters.counts")}
                  options={triggers}
                  trigger={trigger}
                  onChange={(changed) =>
                    set(index, { ...counter, trigger: changed })
                  }
                />
                <TriggerFilter
                  trigger={trigger}
                  gifts={gifts}
                  emotes={emotes}
                  onChange={(changed) =>
                    set(index, { ...counter, trigger: changed })
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
      <Btn
        className={styles.add_trigger}
        disabled={counters.length >= STUDIO_MAX_COUNTERS}
        onClick={() => onChange([...counters, newCounter()])}
      >
        <FiPlus size={16} aria-hidden />
        {t("studio.counters.add")}
      </Btn>
    </div>
  );
}
