import { formatAdded, getSoundPreviewURL } from "@/common/util";
import { useState } from "react";
import styles from "./soundpicker.module.css";

type Props = {
  // A sound library file, whose length is read from disk
  file?: string;
  // The length already known, from a preview
  seconds?: number;
};

/**
 * A sound's or video's length ("2.5s", "1:05") once it's known. Nothing
 * shows for a file that doesn't say its length.
 */
export function SoundLength({ file, seconds }: Props) {
  const [read, setRead] = useState<number>();
  const length = seconds ?? read;
  return (
    <>
      {file && seconds === undefined && (
        <audio
          src={getSoundPreviewURL(file)}
          preload="metadata"
          onLoadedMetadata={(e) => setRead(e.currentTarget.duration)}
        />
      )}
      {length !== undefined && Number.isFinite(length) && length > 0 && (
        <span className={styles.length}>{formatAdded(length * 1000)}</span>
      )}
    </>
  );
}
