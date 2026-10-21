import { Profile } from "@/common/schemas";
import { Btn, EmptyState, Input, Section } from "@/components";
import { Updater } from "@/hooks";
import { FiArrowRight, FiPlus, FiTrash2 } from "react-icons/fi";
import styles from "../tts.module.css";

type Replacements = Profile["tts"]["replacements"];

interface Props {
  replacements: Replacements;
  update: Updater<Replacements>;
}

export function ReplacementsSection({ replacements, update }: Props) {
  return (
    <Section
      title="Replacements"
      description="Words to pronounce differently, like brb."
      actions={
        <Btn
          variant="icon"
          title="Add Replacement"
          onClick={() =>
            update((r) => {
              r.push({ old: "", new: "" });
            })
          }
        >
          <FiPlus size={20} />
        </Btn>
      }
    >
      <div className={styles.replacements}>
        {replacements.map((replacement, index) => (
          <div key={index} className={styles.replacement}>
            <Input
              placeholder="Word to replace (e.g. 'brb')"
              value={replacement.old}
              onChange={(e) =>
                update((r) => {
                  r[index].old = e.target.value;
                })
              }
            />
            <FiArrowRight size={16} className={styles.replacement_arrow} />
            <Input
              placeholder="How it sounds (e.g. 'be right back')"
              value={replacement.new}
              onChange={(e) =>
                update((r) => {
                  r[index].new = e.target.value;
                })
              }
            />
            <Btn
              variant="icon"
              title="Remove"
              onClick={() =>
                update((r) => {
                  r.splice(index, 1);
                })
              }
            >
              <FiTrash2 size={18} />
            </Btn>
          </div>
        ))}

        {replacements.length === 0 && (
          <EmptyState>No custom replacements added.</EmptyState>
        )}
      </div>
    </Section>
  );
}
