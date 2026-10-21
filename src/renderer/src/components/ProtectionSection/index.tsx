import { Profile } from "@/common/schemas";
import { Updater } from "@/hooks/useImmerState";
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
  // Feature name shown in the description
  feature: "TTS" | "Music";
  // More fields, after the shared ones
  children?: ReactNode;
}

export function ProtectionSection({
  protection,
  update,
  feature,
  children,
}: Props) {
  return (
    <Section
      title="Protection"
      description={`Set limits and word filters to prevent chat from abusing the ${feature} system.`}
    >
      <FormGrid>
        <Field label="Cooldown" hint="(seconds)">
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
        <Field label="Max Queue Length">
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
