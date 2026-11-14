import { MessageKey } from "@/common/i18n";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CameraFailure,
  CloneLimits,
  VoiceEngine,
  VoiceSample,
} from "@/common/types";
import { VOICE_NAME_MAX, VOICE_SAMPLES_MAX } from "@/common/util/constants";
import { formatSeconds } from "@/common/util/format";
import {
  Btn,
  Check,
  Field,
  Input,
  Modal,
  PlayButton,
  Select,
} from "@/components";
import { joinedWav } from "@/helper/wav";
import { useAudio } from "@/hooks/useAudio";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useLanguage, useT } from "@/ui/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import styles from "./clonevoice.module.css";
import { useRecorder } from "./useRecorder";

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

export type Cloner = VoiceEngine & { cloning: CloneLimits };

type Props = {
  engines: Cloner[];
  onClose: () => void;
};

// Decoding resamples every sample to this rate
const JOIN_RATE = 44100;

// The samples as one WAV, or the first one that doesn't decode
async function join(samples: Row[], maxSeconds: number) {
  const context = new OfflineAudioContext(1, 1, JOIN_RATE);
  const buffers: AudioBuffer[] = [];
  for (const row of samples) {
    try {
      // A copy: decoding detaches the bytes it gets
      buffers.push(await context.decodeAudioData(row.data.slice().buffer));
    } catch {
      return { unreadable: row };
    }
  }
  return { data: joinedWav(buffers, maxSeconds) };
}

/**
 * Clones a voice with the engine from audio files and recordings. Main shows
 * whether it worked; the dialog closes when it did and keeps everything when
 * it didn't.
 */
export function CloneVoiceModal({ engines, onClose }: Props) {
  const t = useT();
  const language = useLanguage();
  const [engineId, setEngineId] = useState(engines[0].id);
  const engine = engines.find((e) => e.id === engineId) ?? engines[0];
  const limits = engine.cloning;
  const joins = limits.samples === 1;
  // The sample that didn't decode for joining, by id
  const [unreadable, setUnreadable] = useState<number | null>(null);
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

  const recorder = useRecorder(limits.maxSeconds, (data) => {
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

  // Closing cuts the sample playing, and a clone still joining its samples
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      queue.stop();
    };
  }, [queue]);

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

  const clone = async () => {
    const id = crypto.randomUUID();
    setCloning(id);
    setUnreadable(null);
    let sending = samples.map(({ name, data }) => ({ name, data }));
    if (joins) {
      const joined = await join(samples, limits.maxSeconds);
      if (!open.current) return;
      if (joined.unreadable) {
        setUnreadable(joined.unreadable.id);
        setCloning(null);
        return;
      }
      sending = [{ name: "sample.wav", data: joined.data }];
    }
    window.api.emit(APP_EVENTS.CLONE_VOICE, {
      id,
      engine: engine.id,
      name: name.trim(),
      samples: sending,
    });
  };
  const unreadableRow = joins
    ? samples.find((s) => s.id === unreadable)
    : undefined;

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
            onClick={() => void clone()}
          >
            {t("tts.cloneVoice.clone")}
          </Btn>
        </>
      }
    >
      {engines.length > 1 && (
        <Field label={t("tts.cloneVoice.engine")}>
          <Select
            aria-label={t("tts.cloneVoice.engine")}
            options={engines.map((e) => ({ label: e.label, value: e.id }))}
            value={engine.id}
            disabled={recording || cloning !== null}
            onChange={setEngineId}
          />
        </Field>
      )}

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
                  max: clock(limits.maxSeconds),
                })}
              </span>
              <span className={styles.track} aria-hidden>
                <span
                  className={styles.progress}
                  style={{
                    width: `${(recorder.seconds / limits.maxSeconds) * 100}%`,
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
        {unreadableRow && (
          <p className={styles.error} role="alert">
            {t("tts.cloneVoice.unreadable", { name: unreadableRow.name })}
          </p>
        )}
        <p className={styles.hint}>
          {t("tts.cloneVoice.hint", {
            length: formatSeconds(
              language,
              limits.minSeconds,
              limits.maxSeconds,
            ),
          })}
          {joins &&
            ` ${t("tts.cloneVoice.joined", {
              engine: engine.label,
              max: formatSeconds(language, limits.maxSeconds),
            })}`}
        </p>
      </div>

      <Check
        label={t("tts.cloneVoice.consent")}
        checked={consent}
        onChange={(e) => setConsent(e.target.checked)}
      />
    </Modal>
  );
}
