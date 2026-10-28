import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Check, CopyField, Field, FormGrid, Section } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiMonitor } from "react-icons/fi";
import styles from "../settings.module.css";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function ServerSection({ enabled, onChange }: Props) {
  const t = useT();
  // This PC's addresses, once main answers
  const [addresses, setAddresses] = useState<string[] | null>(null);

  useIpcRequest(APP_EVENTS.GET_NETWORK_ADDRESSES);
  useIpcListener(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, (res) => {
    if (res) setAddresses(res.addresses);
  });

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
              <p className={styles.library_meta}>
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
