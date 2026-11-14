import { Profile } from "@/common/schemas";
import { APP_EVENTS_RESPONSE, VoiceEngine } from "@/common/types";
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
import { Updater, useIpcListener } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiMic } from "react-icons/fi";
import styles from "../tts.module.css";
import { CloneVoiceModal } from "./CloneVoiceModal";

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
  // An engine that clones and lists voices, so its key works
  const [cloner, setCloner] = useState<VoiceEngine | null>(null);
  const [cloning, setCloning] = useState(false);

  // The voice field asks for the voices, and a clone sends them again
  useIpcListener(APP_EVENTS_RESPONSE.GET_VOICES, (res) => {
    if (!res?.success) return;
    const voices = res.voices ?? [];
    const engine = res.engines?.find(
      (e) => e.clones && voices.some((v) => v.engine === e.id),
    );
    setCloner(engine ?? null);
  });

  return (
    <Section
      title={t("tts.voice.title")}
      description={t("tts.voice.description")}
      actions={
        cloner && (
          <Btn
            variant="icon"
            title={t("tts.cloneVoice.title")}
            aria-label={t("tts.cloneVoice.title")}
            onClick={() => setCloning(true)}
          >
            <FiMic size={20} />
          </Btn>
        )
      }
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

      {cloning && cloner && (
        <CloneVoiceModal engine={cloner} onClose={() => setCloning(false)} />
      )}
    </Section>
  );
}
