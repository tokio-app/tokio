import { AppProvider, AppSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import {
  EULER_PRICING_URL,
  EULER_SIGNUP_URL,
  EULER_STREAM_URL,
} from "@/common/util";
import { Field, FormGrid, Input, Section, Select } from "@/components";
import { useAutosave } from "@/hooks";
import { FiBox } from "react-icons/fi";
import styles from "../settings.module.css";

interface Props {
  settings: AppSettings;
}

const link = (href: string, text: string) => (
  <a className={styles.link} href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

export function ProvidersSection({ settings }: Props) {
  return (
    <Section
      icon={<FiBox />}
      title="TikTok LIVE"
      description={
        <>
          Your {link(EULER_STREAM_URL, "Euler Stream")} API key.{" "}
          {link(EULER_SIGNUP_URL, "Get one free")}; your{" "}
          {link(EULER_PRICING_URL, "plan")} sets how often you can connect.
        </>
      }
    >
      <FormGrid>
        <ProviderForm
          type="connector"
          label="TikTok Events"
          providers={settings.providers.connector}
          active={settings.activeConnProvider}
        />
      </FormGrid>
    </Section>
  );
}

interface FormProps {
  type: "connector";
  label: string;
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

  return (
    <div className={styles.provider}>
      {/* Nothing to pick from with a single connector */}
      {providers.length > 1 && (
        <Field label={label}>
          <Select
            options={providers.map((p) => ({ label: p.name, value: p.name }))}
            value={provider.name}
            onChange={(name) => setProvider((p) => ({ ...p, name }))}
          />
        </Field>
      )}
      <Field label="Euler Stream API key">
        <Input
          type="password"
          placeholder="Your API key..."
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
