import { StudioElementOf } from "@/common/schemas";
import { Btn, Check, Field, Slider, useVideoURL } from "@/components";
import { releaseOnUnmount } from "@/helper/media";
import { CutTrack } from "@/pages/Alerts/SoundCut";
import { useT } from "@/ui/i18n";
import { useId, useState } from "react";
import { LuPlay, LuRotateCcw } from "react-icons/lu";
import styles from "./studioeditor.module.css";

type Media = StudioElementOf<"media">;

type Props = {
  element: Media;
  onChange: (element: Media) => void;
  // The frame a cut's handle moved to, which the canvas holds still
  onSeek: (seconds: number) => void;
  // Plays the cut again on the canvas, where without loop it stops
  onPlay: () => void;
};

/**
 * A video's cut, the alerts' track, then whether it loops and its volume.
 * The canvas is its preview. Keyed by the file: another one starts over.
 */
export function VideoFields({ element, onChange, onSeek, onPlay }: Props) {
  const t = useT();
  const title = useId();
  const src = useVideoURL(element.file);
  // Its length once it's read, NaN when the video doesn't say
  const [length, setLength] = useState<number>();
  const cut = element.start !== 0 || element.end !== null;
  const reset = t("studio.fields.cutReset");
  const play = t("studio.fields.playAgain");
  const volume = t("studio.fields.volume", { volume: String(element.volume) });

  return (
    <>
      {/* Reads its length for the track, as SoundLength reads a sound's */}
      <video
        ref={releaseOnUnmount}
        src={src}
        preload="metadata"
        hidden
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
        onError={() => setLength(NaN)}
      />
      {/* A video that doesn't say its length can't be cut, as in alerts */}
      {length !== undefined && Number.isFinite(length) && length > 0 && (
        <div className={styles.titled} role="group" aria-labelledby={title}>
          <div className={styles.titled_head}>
            <span id={title} className={styles.titled_name}>
              {t("studio.fields.cut")}
            </span>
            <div className={styles.icon_buttons}>
              <Btn
                variant="icon"
                title={reset}
                aria-label={reset}
                disabled={!cut}
                onClick={() => onChange({ ...element, start: 0, end: null })}
              >
                <LuRotateCcw size={16} />
              </Btn>
            </div>
          </div>
          <CutTrack
            duration={length}
            cut={element}
            playing={false}
            actions={null}
            onChange={(part) => onChange({ ...element, ...part })}
            onSeek={onSeek}
          />
        </div>
      )}
      {/* Without loop it plays once, and stops: Play again replays it */}
      <div className={styles.check_row}>
        <Check
          label={t("studio.fields.loop")}
          checked={element.loop}
          onChange={(e) => onChange({ ...element, loop: e.target.checked })}
        />
        {!element.loop && (
          <Btn variant="icon" title={play} aria-label={play} onClick={onPlay}>
            <LuPlay size={16} />
          </Btn>
        )}
      </div>
      <Field label={volume}>
        <Slider
          aria-label={volume}
          min={0}
          max={100}
          value={element.volume}
          onChange={(value) => onChange({ ...element, volume: value })}
        />
      </Field>
    </>
  );
}
