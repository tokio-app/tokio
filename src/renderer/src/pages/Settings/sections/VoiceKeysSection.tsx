import { APP_EVENTS, APP_EVENTS_RESPONSE, VoiceEngine } from "@/common/types";
import { Field, FormGrid, Input, Section } from "@/components";
import { useAutosave, useIpcListener, useIpcRequest } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiKey } from "react-icons/fi";
import styles from "../settings.module.css";

type EngineKey = VoiceEngine & { key: string };

// Keys for the voice engines that take one. Hidden when none does.
export function VoiceKeysSection() {
  const [engines, setEngines] = useState<EngineKey[]>([]);

  useIpcRequest(APP_EVENTS.GET_VOICE_KEYS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, (res) => {
    if (res?.success) setEngines(res.engines!);
  });

  if (engines.length === 0) return null;

  return (
    <Section
      icon={<FiKey />}
      title="Voice Engines"
      description="Keys for the TTS voice engines."
    >
      <FormGrid>
        {engines.map((engine) => (
          <KeyForm key={engine.id} engine={engine} />
        ))}
      </FormGrid>
    </Section>
  );
}

// Saved as it changes; an empty key removes the saved one
function KeyForm({ engine }: { engine: EngineKey }) {
  const t = useT();
  // Only engines with one are listed
  const keyLabel = engine.keyLabel ? t(engine.keyLabel) : "";
  const [key, setKey] = useAutosave(engine.key, (value) =>
    window.api.emit(APP_EVENTS.SET_VOICE_KEY, {
      engine: engine.id,
      key: value,
    }),
  );

  return (
    <div className={styles.provider}>
      <Field label={`${engine.label} voices`} hint={`(${keyLabel}, optional)`}>
        <Input
          type="password"
          placeholder={`${engine.label} ${keyLabel}...`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
    </div>
  );
}
