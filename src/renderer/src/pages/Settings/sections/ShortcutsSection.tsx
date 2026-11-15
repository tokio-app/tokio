import { Shortcuts } from "@/common/schemas";
import { CONTROL_ACTIONS, ControlAction } from "@/common/types";
import { Field, FormGrid, Section, ShortcutField } from "@/components";
import { useT } from "@/ui/i18n";
import { LuKeyboard } from "react-icons/lu";
import styles from "../settings.module.css";

interface Props {
  shortcuts: Shortcuts;
  // The ones another app holds, which don't fire
  taken: ControlAction[];
  onChange: (action: ControlAction, accelerator: string) => void;
}

export function ShortcutsSection({ shortcuts, taken, onChange }: Props) {
  const t = useT();
  return (
    <Section
      icon={<LuKeyboard />}
      title={t("settings.shortcuts.title")}
      description={t("settings.shortcuts.description")}
    >
      <FormGrid>
        {CONTROL_ACTIONS.map((action) => (
          <Field key={action} label={t(`settings.shortcuts.${action}`)}>
            <ShortcutField
              value={shortcuts[action]}
              onChange={(accelerator) => onChange(action, accelerator)}
            />
            {taken.includes(action) && (
              <p className={styles.taken}>{t("settings.shortcuts.taken")}</p>
            )}
          </Field>
        ))}
      </FormGrid>
    </Section>
  );
}
