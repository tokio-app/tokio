import { Profile } from "@/common/schemas";
import { Check, Input, Section } from "@/components";
import { Updater } from "@/hooks";
import styles from "../music.module.css";

type Controls = Profile["music"]["controls"];

const CONTROLS: { key: keyof Controls; label: string }[] = [
  { key: "play", label: "Play" },
  { key: "next", label: "Next" },
  { key: "last", label: "Last" },
  { key: "revoke", label: "Revoke" },
];

interface Props {
  controls: Controls;
  update: Updater<Controls>;
}

export function ControlsSection({ controls, update }: Props) {
  return (
    <Section title="Controls" description="Chat commands for playback.">
      <div className={styles.controls}>
        {CONTROLS.map(({ key, label }) => (
          <div key={key} className={styles.control}>
            <div className={styles.control_label}>
              <Check
                label={label}
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
