import { MessageKey } from "@/common/i18n";
import { AppProvider, AppSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import {
  EULER_PRICING_URL,
  EULER_SIGNUP_URL,
  EULER_STREAM_URL,
} from "@/common/util";
import { Field, FormGrid, Input, Section, Select } from "@/components";
import { useAutosave } from "@/hooks";
import { rich, useT } from "@/ui/i18n";
import { ReactNode } from "react";
import { FiBox } from "react-icons/fi";
import styles from "../settings.module.css";

interface Props {
  settings: AppSettings;
}

const link = (href: string) => (text: ReactNode) => (
  <a className={styles.link} href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

export function ProvidersSection({ settings }: Props) {
  const t = useT();
  return (
    <Section
      icon={<FiBox />}
      title="TikTok LIVE"
      description={rich(t("settings.providers.description"), {
        euler: link(EULER_STREAM_URL),
        signup: link(EULER_SIGNUP_URL),
        pricing: link(EULER_PRICING_URL),
      })}
    >
      <FormGrid>
        <ProviderForm
          type="connector"
          label="settings.providers.connector"
          providers={settings.providers.connector}
          active={settings.activeConnProvider}
        />
      </FormGrid>
    </Section>
  );
}

interface FormProps {
  type: "connector";
  label: MessageKey;
  providers: AppProvider[];
  active: AppProvider;
}

// Saved as it changes
function ProviderForm({ type, label, providers, active }: FormProps) {
  const [provider, setProvider] = useAutosave(
    { name: active.name, key: active.key },
    ({ name, key }) =>
      window.api.emit(APP_EVENTS.SET_PROVIDER, { name, key, type }),
  );
  const t = useT();

  return (
    <div className={styles.provider}>
      {/* Nothing to pick from with a single connector */}
      {providers.length > 1 && (
        <Field label={t(label)}>
          <Select
            options={providers.map((p) => ({ label: p.name, value: p.name }))}
            value={provider.name}
            onChange={(name) => setProvider((p) => ({ ...p, name }))}
          />
        </Field>
      )}
      <Field label={t("settings.providers.key")}>
        <Input
          type="password"
          placeholder={t("settings.providers.keyPlaceholder")}
          value={provider.key}
          onChange={(e) => {
            const key = e.target.value;
            setProvider((p) => ({ ...p, key }));
          }}
        />
      </Field>
    </div>
  );
}
