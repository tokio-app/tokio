import { AlertTts, Trigger } from "@/common/schemas";
import { TOKIO_EVENTS } from "@/common/types";
import {
  ALERT_MESSAGE_VARIABLES,
  rowVariables,
  samplePlatform,
} from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useVariables } from "@/hooks/useVariables";
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
  // Every trigger the alert has, the first first
  triggers: Trigger[];
  value: AlertTts;
  onChange: (tts: AlertTts) => void;
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
};

export function TtsTab({
  alertId,
  triggers,
  value,
  onChange,
  testing,
  onTest,
}: Props) {
  const t = useT();
  const messageRef = useRef<HTMLInputElement>(null);
  const testId = `${alertId}:tts`;
  const platforms = usePlatforms();
  // An alert on every gift speaks for each one, it has no count to say. The
  // message can say what any of the triggers has on its platforms.
  const variables = useVariables([
    ...new Set(
      triggers.flatMap((trigger) =>
        rowVariables(
          trigger.type === TOKIO_EVENTS.GIFT && trigger.every_gift
            ? ALERT_MESSAGE_VARIABLES[trigger.type].filter(
                (name) => name !== "count",
              )
            : ALERT_MESSAGE_VARIABLES[trigger.type],
          trigger,
          platforms,
        ),
      ),
    ),
  ]);

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
                trigger: triggers[0].type,
                platform: samplePlatform(triggers[0], platforms),
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
          empty={t("common.noVariables")}
        />
      </Field>

      <Field label={t("components.soundPicker.voice")}>
        <VoiceSelect
          value={value.voice}
          filters={value}
          onChange={(voice) => onChange({ ...value, voice })}
        />
      </Field>

      <Field label={t("common.speed", { speed: value.speed })}>
        <Slider
          min={0.5}
          max={2}
          step={0.1}
          value={value.speed}
          onChange={(speed) => onChange({ ...value, speed })}
        />
      </Field>

      <Field label={t("common.pitch", { pitch: value.pitch })}>
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
