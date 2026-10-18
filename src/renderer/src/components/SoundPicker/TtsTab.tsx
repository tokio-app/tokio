import { AlertTts } from "@/common/schemas";
import {
  AlertTrigger,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  VoiceData,
  VoiceEngine,
} from "@/common/types";
import { ALERT_MESSAGE_VARIABLES } from "@/common/util";
import { voiceKey, voiceOptions } from "@/helper/voices";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useMemo, useRef, useState } from "react";
import { Input, Select, Slider } from "../Elements";
import { Field } from "../Page";
import { PlayButton, PREVIEW_VOLUME } from "../PlayButton";
import { VariableList } from "../VariableList";
import styles from "./soundpicker.module.css";

type Props = {
  // Id of the alert, the test is named after it
  alertId: string;
  trigger: AlertTrigger;
  value: AlertTts;
  onChange: (tts: AlertTts) => void;
  testing: string | null;
  onTest: (req: AlertTestRequest) => void;
};

export function TtsTab({
  alertId,
  trigger,
  value,
  onChange,
  testing,
  onTest,
}: Props) {
  const [voices, setVoices] = useState<VoiceData[]>([]);
  const [engines, setEngines] = useState<VoiceEngine[]>([]);
  const messageRef = useRef<HTMLInputElement>(null);

  useIpcRequest(APP_EVENTS.GET_VOICES);

  useIpcListener(APP_EVENTS_RESPONSE.GET_VOICES, (res) => {
    if (!res?.success) return;
    setVoices(res.voices!);
    setEngines(res.engines!);
  });

  const options = useMemo(
    () => voiceOptions(voices, engines),
    [voices, engines],
  );
  const testId = `${alertId}:tts`;

  return (
    <div className={styles.tts}>
      <Field label="Message">
        <div className={styles.tts_message}>
          <Input
            ref={messageRef}
            placeholder="Type what the alert says..."
            value={value.message}
            onChange={(e) => onChange({ ...value, message: e.target.value })}
          />
          <PlayButton
            playing={testing === testId}
            disabled={value.message.trim() === ""}
            onClick={() =>
              onTest({
                id: testId,
                tts: value,
                trigger,
                volume: PREVIEW_VOLUME,
              })
            }
          />
        </div>
        <VariableList
          variables={ALERT_MESSAGE_VARIABLES[trigger]}
          inputRef={messageRef}
          value={value.message}
          onChange={(message) => onChange({ ...value, message })}
          empty="This event has no variables."
        />
      </Field>

      <Field label="Voice">
        <Select
          searchable
          options={options}
          value={voiceKey(value.voice)}
          placeholder={`${value.voice.lang} - ${value.voice.name}`}
          onChange={(key) => {
            const voice = voices.find((v) => voiceKey(v) === key);
            if (voice) onChange({ ...value, voice });
          }}
        />
      </Field>

      <Field label={`Speed (${value.speed}x)`}>
        <Slider
          min={0.5}
          max={2}
          step={0.1}
          value={value.speed}
          onChange={(speed) => onChange({ ...value, speed })}
        />
      </Field>

      <Field label={`Pitch (${value.pitch})`}>
        <Slider
          min={0.5}
          max={2}
          step={0.1}
          value={value.pitch}
          onChange={(pitch) => onChange({ ...value, pitch })}
        />
      </Field>
    </div>
  );
}
