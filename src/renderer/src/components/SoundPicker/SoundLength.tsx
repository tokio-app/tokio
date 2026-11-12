import { cutPart, formatAdded, getSoundPreviewURL } from "@/common/util";
import { releaseOnUnmount } from "@/helper/media";
import { useNearView } from "@/hooks/useNearView";
import { useState } from "react";
import styles from "./soundpicker.module.css";

type Props = {
  // A sound library file, whose length is read from disk
  file?: string;
  // The length already known, from a preview
  seconds?: number;
  // The part of the file that plays, like an alert's cut
  cut?: { start: number; end: number | null };
};

/**
 * A sound's or video's length ("2.5s", "1:05") once it's known. Nothing
 * shows for a file that doesn't say its length.
 */
export function SoundLength({ file, seconds, cut }: Props) {
  const [read, setRead] = useState<number>();
  const [nearRef, near] = useNearView<HTMLSpanElement>();
  // The part the queue plays: a cut that doesn't fit plays the whole file
  const part =
    read === undefined
      ? undefined
      : cutPart(cut ?? { start: 0, end: null }, read);
  const length = seconds ?? (part && part.stop - part.start);
  const shown = length !== undefined && Number.isFinite(length) && length > 0;
  const text = shown ? formatAdded(length * 1000) : null;
  // A file's length is read only while it's in view; the span is what's
  // observed, since a hidden audio has no box
  if (!file || seconds !== undefined)
    return text && <span className={styles.length}>{text}</span>;
  return (
    <>
      {near && read === undefined && (
        <audio
          ref={releaseOnUnmount}
          src={getSoundPreviewURL(file)}
          preload="metadata"
          onLoadedMetadata={(e) => setRead(e.currentTarget.duration)}
          onError={() => setRead(NaN)}
        />
      )}
      <span ref={nearRef} className={styles.length}>
        {text}
      </span>
    </>
  );
}
