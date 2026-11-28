import { Check, CopyField, Field, FormGrid, Section } from "@/components";
import { useT } from "@/ui/i18n";
import { FiMonitor } from "react-icons/fi";
import styles from "../settings.module.css";

interface Props {
  enabled: boolean;
  // This PC's addresses, once main answers
  addresses: string[] | null;
  onChange: (enabled: boolean) => void;
}

export function ServerSection({ enabled, addresses, onChange }: Props) {
  const t = useT();

  return (
    <Section
      icon={<FiMonitor />}
      title={t("settings.server.title")}
      description={t("settings.server.description")}
    >
      <Check
        label={t("settings.server.enable")}
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {/* Another computer points tokio-app.local at it, in its hosts file
          or a DNS entry, so the field shows the IP alone. A grid column,
          as wide as the Euler Stream key's field. */}
      {addresses && (
        <FormGrid>
          <Field
            label={t("settings.server.address")}
            hint={t("settings.server.addressHint")}
          >
            {addresses.length === 0 ? (
              <p className={styles.no_address}>
                {t("settings.server.noAddress")}
              </p>
            ) : (
              addresses.map((ip) => (
                <CopyField
                  key={ip}
                  value={ip}
                  title={t("settings.server.copyAddress")}
                />
              ))
            )}
          </Field>
        </FormGrid>
      )}
    </Section>
  );
}
