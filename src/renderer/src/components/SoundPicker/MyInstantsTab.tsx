import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useState } from "react";
import { FiCheckCircle, FiDownload } from "react-icons/fi";
import { Btn, Input } from "../Elements";
import { PlayButton, PREVIEW_VOLUME } from "../PlayButton";
import styles from "./soundpicker.module.css";
import { useSoundSearch } from "./useSoundSearch";

type Props = {
  // Id of the alert the picked sound is for
  id: string;
  // Hidden tabs stay mounted, so results and scroll survive tab switches
  hidden: boolean;
  testing: string | null;
  onTest: (req: AlertTestRequest) => void;
};

export function MyInstantsTab({ id, hidden, testing, onTest }: Props) {
  const [query, setQuery] = useState("");
  // Url of the sound being downloaded
  const [downloading, setDownloading] = useState<string | null>(null);

  const { sounds, loading, error, search, retry, listRef, sentinelRef } =
    useSoundSearch(!hidden);

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
        {sounds.map((sound) => (
          <div key={sound.url} className={styles.row}>
            <span className={styles.name} title={sound.name}>
              {sound.name}
            </span>
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
            <Btn
              variant="icon"
              active={sound.saved}
              title={
                sound.saved ? "Already saved, use this sound" : "Use this sound"
              }
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
              {sound.saved ? (
                <FiCheckCircle size={20} />
              ) : (
                <FiDownload size={20} />
              )}
            </Btn>
          </div>
        ))}

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
