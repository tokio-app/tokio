import { AlertTts } from "@/common/schemas";
import { AlertTrigger } from "@/common/types";
import { ALERT_MESSAGE_VARIABLES } from "@/common/util";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useRef } from "react";
import { Input, Slider } from "../Elements";
import { Field } from "../Page";
import {
  PlayButton,
  PREVIEW_VOLUME,
  TestState,
  testProps,
} from "../PlayButton";
import { VariableList } from "../VariableList";
import { VoiceSelect } from "../VoiceSelect";
import styles from "./soundpicker.module.css";

type Props = {
  // Id of the alert, the test is named after it
  alertId: string;
  trigger: AlertTrigger;
  value: AlertTts;
  onChange: (tts: AlertTts) => void;
  testing: TestState;
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
  const messageRef = useRef<HTMLInputElement>(null);
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
            {...testProps(testing, testId)}
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
        <VoiceSelect
          value={value.voice}
          filters={value}
          onChange={(voice) => onChange({ ...value, voice })}
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
