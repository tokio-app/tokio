import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { cx } from "@/helper/cx";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useState } from "react";
import { FiDownload, FiTrash2 } from "react-icons/fi";
import { Btn, Input } from "../Elements";
import { PlayButton, PREVIEW_VOLUME } from "../PlayButton";
import styles from "./soundpicker.module.css";
import { useSoundSearch } from "./useSoundSearch";

type Props = {
  // Id of the alert the picked sound is for
  id: string;
  // Hidden tabs stay mounted, so results and scroll survive tab switches
  hidden: boolean;
  // Downloaded sounds are in the library
  library: AlertSound[];
  testing: string | null;
  onTest: (req: AlertTestRequest) => void;
  onSelect: (sound: AlertSound) => void;
};

export function MyInstantsTab({
  id,
  hidden,
  library,
  testing,
  onTest,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  // Url of the sound being downloaded
  const [downloading, setDownloading] = useState<string | null>(null);

  const { sounds, loading, error, search, retry, listRef, sentinelRef } =
    useSoundSearch(!hidden);

  const saved = new Map(library.map((s) => [s.file, s]));

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (res?.id === id) setDownloading(null);
  });

  return (
    <div className={hidden ? styles.hidden : styles.contents}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <Input
          placeholder="Search sounds... (Enter)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      <div ref={listRef} className={styles.list}>
        {sounds.map((sound) => {
          const entry = saved.get(sound.file);
          return (
            <div key={sound.url} className={styles.row}>
              {entry ? (
                <button
                  type="button"
                  className={cx(styles.name, styles.pick)}
                  title={sound.name}
                  onClick={() => onSelect(entry)}
                >
                  {sound.name}
                </button>
              ) : (
                <span className={styles.name} title={sound.name}>
                  {sound.name}
                </span>
              )}
              <PlayButton
                playing={testing === sound.url}
                onClick={() =>
                  onTest({
                    id: sound.url,
                    url: sound.url,
                    volume: PREVIEW_VOLUME,
                  })
                }
              />
              {entry ? (
                <Btn
                  variant="icon"
                  title="Remove from your sounds"
                  disabled={downloading !== null}
                  onClick={() =>
                    window.api.emit(APP_EVENTS.REMOVE_SOUND, {
                      file: sound.file,
                    })
                  }
                >
                  <FiTrash2 size={20} />
                </Btn>
              ) : (
                <Btn
                  variant="icon"
                  title="Download and use this sound"
                  disabled={downloading !== null}
                  onClick={() => {
                    setDownloading(sound.url);
                    window.api.emit(APP_EVENTS.DOWNLOAD_SOUND, {
                      id,
                      url: sound.url,
                      name: sound.name,
                    });
                  }}
                >
                  <FiDownload size={20} />
                </Btn>
              )}
            </div>
          );
        })}

        {loading && <p className={styles.status}>Loading...</p>}
        {!loading && sounds.length === 0 && !error && (
          <p className={styles.status}>No sounds found.</p>
        )}
        {error && (
          <div className={styles.failed}>
            <p>{error}</p>
            <Btn onClick={retry}>Try again</Btn>
          </div>
        )}

        <div ref={sentinelRef} />
      </div>
    </div>
  );
}
