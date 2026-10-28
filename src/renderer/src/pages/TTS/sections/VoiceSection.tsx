import { Profile } from "@/common/schemas";
import {
  Btn,
  Field,
  FormGrid,
  Input,
  Section,
  Slider,
  VoiceSelect,
} from "@/components";
import { AudioQueue } from "@/helper";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import styles from "../tts.module.css";

type Settings = Profile["tts"];

interface Props {
  settings: Settings;
  testLoading: boolean;
  testQueue: AudioQueue;
  update: Updater<Settings>;
  onTest: (text: string) => void;
}

export function VoiceSection({
  settings,
  testLoading,
  testQueue,
  update,
  onTest,
}: Props) {
  const [testMessage, setTestMessage] = useState("");
  const { filters } = settings;
  const t = useT();

  return (
    <Section
      title={t("tts.voice.title")}
      description={t("tts.voice.description")}
    >
      <FormGrid>
        <Field label={t("tts.voice.selection")}>
          <VoiceSelect
            value={settings.voice}
            filters={filters}
            onChange={(voice) =>
              update((s) => {
                s.voice = voice;
              })
            }
          />
        </Field>

        <Field label={t("common.speed", { speed: filters.speed })}>
          <Slider
            min={0.5}
            max={2}
            step={0.1}
            value={filters.speed}
            onChange={(speed) => {
              update((s) => {
                s.filters.speed = speed;
              });
              testQueue.setFilters({ speed });
            }}
          />
        </Field>

        <Field label={t("common.pitch", { pitch: filters.pitch })}>
          <Slider
            min={0.5}
            max={2}
            step={0.1}
            value={filters.pitch}
            onChange={(pitch) => {
              update((s) => {
                s.filters.pitch = pitch;
              });
              testQueue.setFilters({ pitch });
            }}
          />
        </Field>

        <Field label={t("tts.voice.volume", { volume: filters.volume })}>
          <Slider
            min={0}
            max={100}
            value={filters.volume}
            onChange={(volume) => {
              update((s) => {
                s.filters.volume = volume;
              });
              testQueue.setFilters({ volume: volume / 100 });
            }}
          />
        </Field>
      </FormGrid>

      <div className={styles.tester}>
        <Btn
          variant="accent"
          className={styles.tester_btn}
          loading={testLoading}
          disabled={testMessage === ""}
          onClick={() => onTest(testMessage)}
        >
          {t("tts.voice.test")}
        </Btn>
        <Input
          placeholder={t("tts.voice.testPlaceholder")}
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
        />
      </div>
    </Section>
  );
}
