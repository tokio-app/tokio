import { Alert } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { cutPart, formatAdded } from "@/common/util";
import { Btn, NumberInput, Spinner } from "@/components";
import { cx } from "@/helper";
import { useAudio, useIpcListener } from "@/hooks";
import { useT } from "@/ui/i18n";
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
// A sound's or video's
export type Cut = Pick<Sound, "start" | "end">;
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
  const t = useT();
  const { decode } = useAudio();
  const { file } = sound;
  const [audio, setAudio] = useState<{
    file: string;
    peaks: number[];
    duration: number;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The sound shown now, which a decode that ends late checks against
  const current = useRef(file);

  useEffect(() => {
    current.current = file;
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
      (buffer) => {
        if (current.current !== res.file) return;
        setAudio({
          file: res.file,
          peaks: waveform(buffer, BARS),
          duration: buffer.duration,
        });
      },
      () => {
        if (current.current === res.file) setFailed(res.file);
      },
    );
  });

  // Shown while the waveform loads or can't, too
  const actions = (
    <span className={styles.cut_actions}>
      {play}
      <ResetCut cut={sound} onChange={onChange} />
    </span>
  );

  if (audio?.file === file) {
    return (
      <CutTrack
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
        <p className={styles.error}>{t("alerts.cut.readFailed")}</p>
      ) : (
        <div className={styles.wave_loading}>
          <Spinner />
        </div>
      )}
      <div className={styles.cut_fields}>{actions}</div>
    </div>
  );
}

// Plays the whole sound or video again
export function ResetCut({
  cut,
  onChange,
}: {
  cut: Cut;
  onChange: (cut: Cut) => void;
}) {
  const t = useT();
  return (
    <Btn
      disabled={cut.start === 0 && cut.end === null}
      onClick={() => onChange({ start: 0, end: null })}
    >
      {t("alerts.cut.reset")}
    </Btn>
  );
}

type CutTrackProps = {
  // The sound's waveform, a plain track without
  peaks?: number[];
  duration: number;
  cut: Cut;
  playing: boolean;
  actions: ReactNode;
  onChange: (cut: Cut) => void;
  // The seconds a handle moved to
  onSeek?: (seconds: number) => void;
};

/**
 * The part of a sound or video that plays, between two handles over its
 * length, and their seconds.
 */
export function CutTrack({
  peaks,
  duration,
  cut,
  playing,
  actions,
  onChange,
  onSeek,
}: CutTrackProps) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const handles = useRef<Record<Handle, HTMLDivElement | null>>({
    start: null,
    end: null,
  });
  const dragging = useRef<Handle | null>(null);

  const { start, stop } = cutPart(cut, duration);
  const percent = (value: number) => `${(value / duration) * 100}%`;

  const setStart = (value: number) => {
    const next = round(Math.max(0, Math.min(value, stop - MIN_PART)));
    onSeek?.(next);
    onChange({ start: next, end: cut.end });
  };
  // At the sound's end, it plays to the end.
  const setEnd = (value: number) => {
    const end = Math.min(Math.max(value, start + MIN_PART), duration);
    onSeek?.(end);
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
      aria-label={t(handle === "start" ? "alerts.cut.start" : "alerts.cut.end")}
      aria-valuemin={round(min)}
      aria-valuemax={round(max)}
      aria-valuenow={round(value)}
      aria-valuetext={t("alerts.cut.seconds", { count: round(value) })}
      className={styles.handle}
      style={{ left: percent(value) }}
      onKeyDown={(e) => onKeyDown(e, handle, value)}
    />
  );

  return (
    <div className={styles.cut}>
      <div
        ref={box}
        className={cx(styles.wave, !peaks && styles.track)}
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
        {peaks && (
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
        )}
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
          {t("alerts.cut.start")}
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
          {t("alerts.cut.end")}
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
          {t("alerts.cut.plays", {
            part: seconds(stop - start),
            length: seconds(duration),
          })}
        </span>
        {actions}
      </div>
    </div>
  );
}
