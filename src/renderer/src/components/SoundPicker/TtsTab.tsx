import { Alert, AlertTts } from "@/common/schemas";
import { TOKIO_EVENTS } from "@/common/types";
import { ALERT_MESSAGE_VARIABLES } from "@/common/util";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useT } from "@/ui/i18n";
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
  trigger: Alert["trigger"];
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
  const t = useT();
  const messageRef = useRef<HTMLInputElement>(null);
  const testId = `${alertId}:tts`;
  // An alert on every gift speaks for each one, it has no count to say.
  const variables =
    trigger.type === TOKIO_EVENTS.GIFT && trigger.every_gift
      ? ALERT_MESSAGE_VARIABLES[trigger.type].filter((name) => name !== "count")
      : ALERT_MESSAGE_VARIABLES[trigger.type];

  return (
    <div className={styles.tts}>
      <Field label={t("components.soundPicker.message")}>
        <div className={styles.tts_message}>
          <Input
            ref={messageRef}
            placeholder={t("components.soundPicker.messagePlaceholder")}
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
                trigger: trigger.type,
                volume: PREVIEW_VOLUME,
              })
            }
          />
        </div>
        <VariableList
          variables={variables}
          inputRef={messageRef}
          value={value.message}
          onChange={(message) => onChange({ ...value, message })}
          empty={t("components.soundPicker.noVariables")}
        />
      </Field>

      <Field label={t("components.soundPicker.voice")}>
        <VoiceSelect
          value={value.voice}
          filters={value}
          onChange={(voice) => onChange({ ...value, voice })}
        />
      </Field>

      <Field label={t("components.soundPicker.speed", { speed: value.speed })}>
        <Slider
          min={0.5}
          max={2}
          step={0.1}
          value={value.speed}
          onChange={(speed) => onChange({ ...value, speed })}
        />
      </Field>

      <Field label={t("components.soundPicker.pitch", { pitch: value.pitch })}>
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
