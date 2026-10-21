import { AppProvider, AppSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import {
  EULER_PRICING_URL,
  EULER_SIGNUP_URL,
  EULER_STREAM_URL,
} from "@/common/util";
import { Btn, Field, FormGrid, Input, Section, Select } from "@/components";
import { useState } from "react";
import { FiBox, FiSave } from "react-icons/fi";
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
          Tokio connects to TikTok LIVE through{" "}
          {link(EULER_STREAM_URL, "Euler Stream")}, which signs each connection,
          with your own API key: {link(EULER_SIGNUP_URL, "sign up")} for free
          and paste your key here. Your{" "}
          {link(EULER_PRICING_URL, "Euler Stream plan")} sets how often you can
          connect.
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

function ProviderForm({ type, label, providers, active }: FormProps) {
  const [name, setName] = useState(active.name);
  const [key, setKey] = useState(active.key);
  const [prevActive, setPrevActive] = useState(active);

  // Start over from the saved provider when it changes.
  if (active !== prevActive) {
    setPrevActive(active);
    setName(active.name);
    setKey(active.key);
  }

  return (
    <div className={styles.provider}>
      {/* Nothing to pick from with a single connector */}
      {providers.length > 1 && (
        <Field label={label}>
          <Select
            options={providers.map((p) => ({ label: p.name, value: p.name }))}
            value={name}
            onChange={setName}
          />
        </Field>
      )}
      <Field label="Euler Stream API key">
        <Input
          type="password"
          placeholder="Your API key..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Btn
        className={styles.provider_save}
        onClick={() =>
          window.api.emit(APP_EVENTS.SET_PROVIDER, { name, key, type })
        }
      >
        <FiSave /> Save
      </Btn>
    </div>
  );
}
