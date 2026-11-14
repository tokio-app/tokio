import { MessageKey } from "@/common/i18n";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CameraFailure,
  VoiceEngine,
  VoiceSample,
} from "@/common/types";
import { VOICE_NAME_MAX, VOICE_SAMPLES_MAX } from "@/common/util/constants";
import { Btn, Check, Field, Input, Modal, PlayButton } from "@/components";
import { useAudio } from "@/hooks/useAudio";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useT } from "@/ui/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import styles from "./clonevoice.module.css";
import { RECORD_MAX_SECONDS, useRecorder } from "./useRecorder";

const MIC_FAILURES: Record<CameraFailure, MessageKey> = {
  blocked: "tts.cloneVoice.micBlocked",
  missing: "tts.cloneVoice.micMissing",
  busy: "tts.cloneVoice.micBusy",
  failed: "tts.cloneVoice.micFailed",
};

// 2:05 for 125
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// A sample with an id for its row, so removing one keeps the others' state
type Row = VoiceSample & { id: number };
let rows = 0;

type Props = {
  engine: VoiceEngine;
  onClose: () => void;
};

/**
 * Clones a voice with the engine from audio files and recordings. Main shows
 * whether it worked; the dialog closes when it did and keeps everything when
 * it didn't.
 */
export function CloneVoiceModal({ engine, onClose }: Props) {
  const t = useT();
  const queue = useAudio().getQueue("voice-sample");
  const [name, setName] = useState("");
  const [samples, setSamples] = useState<Row[]>([]);
  const [consent, setConsent] = useState(false);
  // The sample playing, by id
  const [playing, setPlaying] = useState<number | null>(null);
  // The CLONE_VOICE request waiting for its reply
  const [cloning, setCloning] = useState<string | null>(null);
  const recordings = useRef(0);
  const labelId = useId();

  const add = (more: VoiceSample[]) =>
    setSamples((list) =>
      [...list, ...more.map((s) => ({ ...s, id: ++rows }))].slice(
        0,
        VOICE_SAMPLES_MAX,
      ),
    );

  const recorder = useRecorder((data) => {
    recordings.current += 1;
    const number = String(recordings.current);
    add([{ name: `${t("tts.cloneVoice.recording", { number })}.webm`, data }]);
  });
  const recording = recorder.state === "recording";

  useIpcListener(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES, (res) => {
    if (res?.success && res.samples) add(res.samples);
  });

  useIpcListener(APP_EVENTS_RESPONSE.CLONE_VOICE, (res) => {
    if (!res || res.id !== cloning) return;
    if (res.success) onClose();
    else setCloning(null);
  });

  // Closing cuts the sample playing.
  useEffect(() => () => queue.stop(), [queue]);

  const play = (row: Row) => {
    queue.stop();
    if (playing === row.id) {
      setPlaying(null);
      return;
    }
    setPlaying(row.id);
    const done = () => setPlaying((p) => (p === row.id ? null : p));
    // A copy: decoding takes the bytes it gets
    void queue
      .enqueue(row.data.slice(), { onEnded: done })
      .then((queued) => !queued && done());
  };

  const remove = (row: Row) => {
    if (playing === row.id) {
      queue.stop();
      setPlaying(null);
    }
    setSamples((list) => list.filter((s) => s.id !== row.id));
  };

  const clone = () => {
    const id = crypto.randomUUID();
    setCloning(id);
    window.api.emit(APP_EVENTS.CLONE_VOICE, {
      id,
      engine: engine.id,
      name: name.trim(),
      samples: samples.map(({ name, data }) => ({ name, data })),
    });
  };

  const full = samples.length >= VOICE_SAMPLES_MAX;
  const fullTitle = full
    ? t("tts.cloneVoice.full", { max: String(VOICE_SAMPLES_MAX) })
    : undefined;
  const ready =
    name.trim() !== "" && samples.length > 0 && consent && !recording;

  return (
    <Modal
      title={t("tts.cloneVoice.title")}
      description={t("tts.cloneVoice.description", {
        engine: engine.label,
      })}
      maxWidth="520px"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{t("common.cancel")}</Btn>
          <Btn
            variant="accent"
            disabled={!ready}
            loading={cloning !== null}
            onClick={clone}
          >
            {t("tts.cloneVoice.clone")}
          </Btn>
        </>
      }
    >
      <Field label={t("tts.cloneVoice.name")}>
        <Input
          aria-label={t("tts.cloneVoice.name")}
          placeholder={t("tts.cloneVoice.namePlaceholder")}
          maxLength={VOICE_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className={styles.samples} role="group" aria-labelledby={labelId}>
        <div className={styles.header}>
          <span id={labelId} className={styles.label}>
            {t("tts.cloneVoice.samples")}
          </span>
          <Btn
            disabled={full || recording}
            title={fullTitle}
            onClick={() => window.api.emit(APP_EVENTS.PICK_VOICE_SAMPLES)}
          >
            {t("tts.cloneVoice.addFiles")}
          </Btn>
          {/* One button for both, so the focus stays on it */}
          {recording ? (
            <Btn onClick={recorder.stop}>{t("tts.cloneVoice.stop")}</Btn>
          ) : (
            <Btn
              disabled={full || recorder.state === "starting"}
              title={fullTitle}
              onClick={recorder.record}
            >
              {t("tts.cloneVoice.record")}
            </Btn>
          )}
        </div>

        <ul className={styles.list}>
          {samples.map((row) => (
            <li key={row.id} className={styles.row}>
              <span className={styles.name} title={row.name}>
                {row.name}
              </span>
              <PlayButton
                playing={playing === row.id}
                onClick={() => play(row)}
              />
              <Btn
                variant="icon"
                title={t("common.remove")}
                onClick={() => remove(row)}
              >
                <FiTrash2 size={20} />
              </Btn>
            </li>
          ))}

          {recording && (
            <li className={styles.row}>
              <span className={styles.dot} aria-hidden />
              <span className={styles.time}>
                {t("tts.cloneVoice.elapsed", {
                  time: clock(recorder.seconds),
                  max: clock(RECORD_MAX_SECONDS),
                })}
              </span>
              <span className={styles.track} aria-hidden>
                <span
                  className={styles.progress}
                  style={{
                    width: `${(recorder.seconds / RECORD_MAX_SECONDS) * 100}%`,
                  }}
                />
              </span>
            </li>
          )}

          {samples.length === 0 && !recording && (
            <li className={styles.empty}>{t("tts.cloneVoice.empty")}</li>
          )}
        </ul>

        {recorder.failure && (
          <p className={styles.error} role="alert">
            {t(MIC_FAILURES[recorder.failure])}
          </p>
        )}
        <p className={styles.hint}>{t("tts.cloneVoice.hint")}</p>
      </div>

      <Check
        label={t("tts.cloneVoice.consent")}
        checked={consent}
        onChange={(e) => setConsent(e.target.checked)}
      />
    </Modal>
  );
}
