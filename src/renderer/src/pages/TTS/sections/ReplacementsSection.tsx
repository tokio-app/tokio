import { Profile } from "@/common/schemas";
import { Btn, EmptyState, Input, Section } from "@/components";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import { FiArrowRight, FiPlus, FiTrash2 } from "react-icons/fi";
import styles from "../tts.module.css";

type Replacements = Profile["tts"]["replacements"];

interface Props {
  replacements: Replacements;
  update: Updater<Replacements>;
}

export function ReplacementsSection({ replacements, update }: Props) {
  const t = useT();
  return (
    <Section
      title={t("tts.replacements.title")}
      description={t("tts.replacements.description")}
      actions={
        <Btn
          variant="icon"
          title={t("tts.replacements.add")}
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
              placeholder={t("tts.replacements.oldPlaceholder")}
              value={replacement.old}
              onChange={(e) =>
                update((r) => {
                  r[index].old = e.target.value;
                })
              }
            />
            <FiArrowRight size={16} className={styles.replacement_arrow} />
            <Input
              placeholder={t("tts.replacements.newPlaceholder")}
              value={replacement.new}
              onChange={(e) =>
                update((r) => {
                  r[index].new = e.target.value;
                })
              }
            />
            <Btn
              variant="icon"
              title={t("common.remove")}
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
          <EmptyState>{t("tts.replacements.empty")}</EmptyState>
        )}
      </div>
    </Section>
  );
}
