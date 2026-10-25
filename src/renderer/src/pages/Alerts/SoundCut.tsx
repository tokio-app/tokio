import { Alert } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { formatAdded } from "@/common/util";
import { Btn, NumberInput, Spinner } from "@/components";
import { useAudio, useIpcListener } from "@/hooks";
import {
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./editor.module.css";
import { waveform } from "./helper";

declare module "react" {
  interface CSSProperties {
    "--from"?: string;
    "--to"?: string;
    "--length"?: string;
  }
}

type Sound = NonNullable<Alert["sound"]>;
type Cut = Pick<Sound, "start" | "end">;
type Handle = "start" | "end";

const BARS = 96;
// The shortest part a cut keeps, and how far the arrow keys move a handle
const MIN_PART = 0.1;
const STEP = 0.1;

const round = (seconds: number) => Math.round(seconds * 100) / 100;
const seconds = (value: number) => formatAdded(value * 1000);

type Props = {
  sound: Sound;
  // The alert's test is playing, not loading
  playing: boolean;
  // The alert's test button, before the cut's reset
  play: ReactNode;
  onChange: (cut: Cut) => void;
};

/**
 * Cuts an alert's sound: its waveform, with a handle at each end of the
 * part that plays, and their seconds.
 */
export function SoundCut({ sound, playing, play, onChange }: Props) {
  const { decode } = useAudio();
  const { file } = sound;
  const [audio, setAudio] = useState<{
    file: string;
    peaks: number[];
    duration: number;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    window.api.emit(APP_EVENTS.GET_SOUND_DATA, { file });
  }, [file]);

  // The reply for another sound picked meanwhile is dropped.
  useIpcListener(APP_EVENTS_RESPONSE.SOUND_DATA, (res) => {
    if (!res || res.file !== file) return;
    if (!res.success || !res.data) {
      setFailed(res.file);
      return;
    }
    decode(res.data, res.file).then(
      (buffer) =>
        setAudio({
          file: res.file,
          peaks: waveform(buffer, BARS),
          duration: buffer.duration,
        }),
      () => setFailed(res.file),
    );
  });

  // Shown while the waveform loads or can't, too
  const actions = (
    <span className={styles.cut_actions}>
      {play}
      <Btn
        disabled={sound.start === 0 && sound.end === null}
        onClick={() => onChange({ start: 0, end: null })}
      >
        Reset cut
      </Btn>
    </span>
  );

  if (audio?.file === file) {
    return (
      <Waveform
        {...audio}
        cut={sound}
        playing={playing}
        actions={actions}
        onChange={onChange}
      />
    );
  }
  return (
    <div className={styles.cut}>
      {failed === file ? (
        <p className={styles.error}>Couldn't read this sound.</p>
      ) : (
        <div className={styles.wave_loading}>
          <Spinner />
        </div>
      )}
      <div className={styles.cut_fields}>{actions}</div>
    </div>
  );
}

type WaveformProps = {
  peaks: number[];
  duration: number;
  cut: Cut;
  playing: boolean;
  actions: ReactNode;
  onChange: (cut: Cut) => void;
};

function Waveform({
  peaks,
  duration,
  cut,
  playing,
  actions,
  onChange,
}: WaveformProps) {
  const box = useRef<HTMLDivElement>(null);
  const handles = useRef<Record<Handle, HTMLDivElement | null>>({
    start: null,
    end: null,
  });
  const dragging = useRef<Handle | null>(null);

  // A cut that doesn't fit the sound plays it whole, as the queue does.
  let start = Math.min(cut.start, duration);
  let stop = Math.min(cut.end ?? duration, duration);
  if (stop <= start) [start, stop] = [0, duration];
  const percent = (value: number) => `${(value / duration) * 100}%`;

  const setStart = (value: number) =>
    onChange({
      start: round(Math.max(0, Math.min(value, stop - MIN_PART))),
      end: cut.end,
    });
  // At the sound's end, it plays to the end.
  const setEnd = (value: number) => {
    const end = Math.min(Math.max(value, start + MIN_PART), duration);
    onChange({
      start: cut.start,
      end: round(end) >= round(duration) ? null : round(end),
    });
  };
  const set = (handle: Handle, value: number) =>
    handle === "start" ? setStart(value) : setEnd(value);

  // Seconds at the pointer
  const at = (x: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(Math.max((x - rect.left) / rect.width, 0), 1) * duration;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const value = at(e.clientX);
    const handle =
      Math.abs(value - start) <= Math.abs(value - stop) ? "start" : "end";
    dragging.current = handle;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Then the keys go on from where it was dropped
    handles.current[handle]?.focus();
    e.preventDefault();
    set(handle, value);
  };

  const onKeyDown = (
    e: KeyboardEvent<HTMLDivElement>,
    handle: Handle,
    value: number,
  ) => {
    const step = e.shiftKey ? 1 : STEP;
    const next = {
      ArrowLeft: value - step,
      ArrowDown: value - step,
      ArrowRight: value + step,
      ArrowUp: value + step,
      Home: 0,
      End: duration,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    set(handle, next);
  };

  const slider = (handle: Handle, value: number, min: number, max: number) => (
    <div
      ref={(el) => {
        handles.current[handle] = el;
      }}
      role="slider"
      tabIndex={0}
      aria-label={handle === "start" ? "Start" : "End"}
      aria-valuemin={round(min)}
      aria-valuemax={round(max)}
      aria-valuenow={round(value)}
      aria-valuetext={`${round(value)} seconds`}
      className={styles.handle}
      style={{ left: percent(value) }}
      onKeyDown={(e) => onKeyDown(e, handle, value)}
    />
  );

  return (
    <div className={styles.cut}>
      <div
        ref={box}
        className={styles.wave}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (dragging.current) set(dragging.current, at(e.clientX));
        }}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
      >
        <span
          className={styles.region}
          style={{ left: percent(start), width: percent(stop - start) }}
        />
        <svg
          className={styles.bars}
          viewBox={`0 0 ${peaks.length} 100`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {peaks.map((peak, i) => {
            const height = Math.max(peak * 92, 2);
            const middle = ((i + 0.5) / peaks.length) * duration;
            return (
              <rect
                key={i}
                x={i + 0.2}
                width={0.6}
                y={(100 - height) / 2}
                height={height}
                className={
                  middle >= start && middle <= stop ? styles.kept : undefined
                }
              />
            );
          })}
        </svg>
        {/* Sweeps the part while the test plays */}
        {playing && (
          <span
            className={styles.playhead}
            style={{
              "--from": percent(start),
              "--to": percent(stop),
              "--length": `${stop - start}s`,
            }}
            aria-hidden
          />
        )}
        {slider("start", start, 0, stop - MIN_PART)}
        {slider("end", stop, start + MIN_PART, duration)}
      </div>

      <div className={styles.cut_fields}>
        <label className={styles.inline}>
          Start
          <NumberInput
            className={styles.number}
            step={0.1}
            min={0}
            max={round(stop - MIN_PART)}
            value={round(start)}
            onChange={setStart}
          />
        </label>
        <label className={styles.inline}>
          End
          <NumberInput
            className={styles.number}
            step={0.1}
            min={round(start + MIN_PART)}
            max={round(duration)}
            value={round(stop)}
            onChange={setEnd}
          />
        </label>
        <span className={styles.note}>
          Plays {seconds(stop - start)} of {seconds(duration)}
        </span>
        {actions}
      </div>
    </div>
  );
}
