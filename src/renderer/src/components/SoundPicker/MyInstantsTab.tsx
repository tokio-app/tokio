import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { cx } from "@/helper/cx";
import { AlertTestRequest } from "@/hooks/useAlertTest";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiDownload, FiTrash2 } from "react-icons/fi";
import { Btn, Input } from "../Elements";
import {
  PlayButton,
  PREVIEW_VOLUME,
  TestState,
  testProps,
} from "../PlayButton";
import { SoundLength } from "./SoundLength";
import styles from "./soundpicker.module.css";
import { useSoundSearch } from "./useSoundSearch";

type Props = {
  // Id of the alert the picked sound is for
  id: string;
  // Hidden tabs stay mounted, so results and scroll survive tab switches
  hidden: boolean;
  // Downloaded sounds are in the library
  library: AlertSound[];
  testing: TestState;
  // Seconds each sound previewed lasts, by URL
  lengths: Record<string, number>;
  onTest: (req: AlertTestRequest) => void;
  // Called when a download for the alert starts, returns its request number
  onRequest: () => number;
  onSelect: (sound: AlertSound) => void;
  // Asks before deleting a downloaded sound
  onRemove: (sound: AlertSound) => void;
};

export function MyInstantsTab({
  id,
  hidden,
  library,
  testing,
  lengths,
  onTest,
  onRequest,
  onSelect,
  onRemove,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  // The sound being downloaded, and the request its reply carries
  const [downloading, setDownloading] = useState<{
    url: string;
    request: number;
  } | null>(null);

  const { sounds, loading, error, search, retry, listRef, sentinelRef } =
    useSoundSearch(!hidden);

  const saved = new Map(library.map((s) => [s.file, s]));

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, (res) => {
    if (res?.id === id && res.request === downloading?.request) {
      setDownloading(null);
    }
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
          placeholder={t("components.soundPicker.searchPlaceholder")}
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
              {/* Known once previewed or downloaded */}
              <SoundLength file={entry?.file} seconds={lengths[sound.url]} />
              <PlayButton
                {...testProps(testing, sound.url)}
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
                  title={t("components.soundPicker.deleteSaved")}
                  disabled={downloading !== null}
                  onClick={() => onRemove(entry)}
                >
                  <FiTrash2 size={20} />
                </Btn>
              ) : (
                <Btn
                  variant="icon"
                  title={t("components.soundPicker.download")}
                  disabled={downloading !== null}
                  onClick={() => {
                    const request = onRequest();
                    setDownloading({ url: sound.url, request });
                    window.api.emit(APP_EVENTS.DOWNLOAD_SOUND, {
                      id,
                      request,
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

        {loading && (
          <p className={styles.status}>{t("components.soundPicker.loading")}</p>
        )}
        {!loading && sounds.length === 0 && !error && (
          <p className={styles.status}>
            {t("components.soundPicker.noResults")}
          </p>
        )}
        {error && (
          <div className={styles.failed}>
            <p>{error.message ?? t("components.soundPicker.unreachable")}</p>
            <Btn onClick={retry}>{t("common.tryAgain")}</Btn>
          </div>
        )}

        <div ref={sentinelRef} />
      </div>
    </div>
  );
}
