import { MessageKey } from "@/common/i18n";
import { Profile } from "@/common/schemas";
import { Check, Input, Section } from "@/components";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import styles from "../music.module.css";

type Controls = Profile["music"]["controls"];

const CONTROLS: { key: keyof Controls; label: MessageKey }[] = [
  { key: "play", label: "music.controls.play" },
  { key: "next", label: "music.controls.next" },
  { key: "last", label: "music.controls.last" },
  { key: "revoke", label: "music.controls.revoke" },
];

interface Props {
  controls: Controls;
  update: Updater<Controls>;
}

export function ControlsSection({ controls, update }: Props) {
  const t = useT();
  return (
    <Section
      title={t("music.controls.title")}
      description={t("music.controls.description")}
    >
      <div className={styles.controls}>
        {CONTROLS.map(({ key, label }) => (
          <div key={key} className={styles.control}>
            <div className={styles.control_label}>
              <Check
                label={t(label)}
                checked={controls[key].enabled}
                onChange={(e) =>
                  update((c) => {
                    c[key].enabled = e.target.checked;
                  })
                }
              />
            </div>
            <Input
              className={styles.control_command}
              placeholder={`!${key}`}
              value={controls[key].command}
              disabled={!controls[key].enabled}
              onChange={(e) =>
                update((c) => {
                  c[key].command = e.target.value;
                })
              }
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
