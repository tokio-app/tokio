import { Profile } from "@/common/schemas";
import { Updater } from "@/hooks/useImmerState";
import { useT } from "@/ui/i18n";
import { ReactNode } from "react";
import { NumberInput } from "../Elements";
import { Field, FormGrid, Section } from "../Page";

// Limits shared by the TTS and Music settings
type Protection = Pick<
  Profile["music"]["protection"],
  "cooldown" | "queue_length"
>;

interface Props {
  protection: Protection;
  update: Updater<Protection>;
  // Feature name shown in the description, in the window's language
  feature: string;
  // More fields, after the shared ones
  children?: ReactNode;
}

export function ProtectionSection({
  protection,
  update,
  feature,
  children,
}: Props) {
  const t = useT();
  return (
    <Section
      title={t("components.protection.title")}
      description={t("components.protection.description", { feature })}
    >
      <FormGrid>
        <Field
          label={t("components.protection.cooldown")}
          hint={t("components.protection.cooldownHint")}
        >
          <NumberInput
            min={0}
            value={protection.cooldown}
            onChange={(cooldown) =>
              update((p) => {
                p.cooldown = cooldown;
              })
            }
          />
        </Field>
        <Field label={t("common.maxQueueLength")}>
          <NumberInput
            min={1}
            integer
            value={protection.queue_length}
            onChange={(length) =>
              update((p) => {
                p.queue_length = length;
              })
            }
          />
        </Field>
      </FormGrid>
      {children}
    </Section>
  );
}
