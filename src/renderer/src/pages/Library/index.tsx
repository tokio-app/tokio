import { AlertSound, MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import {
  BackButton,
  Btn,
  Page,
  SearchToggle,
  Section,
  Tabs,
} from "@/components";
import { formatStat } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useLanguage, useT } from "@/ui/i18n";
import { useState } from "react";
import { FiPlus } from "react-icons/fi";
import styles from "./library.module.css";
import { MediaTab } from "./sections/MediaTab";
import { SoundsTab } from "./sections/SoundsTab";

type Tab = "sounds" | "media";

// Newest first, the ones named by the search
function shown<T extends { name: string }>(list: T[], search: string) {
  const needle = search.trim().toLowerCase();
  return [...list]
    .reverse()
    .filter((item) => item.name.toLowerCase().includes(needle));
}

export function Library() {
  const t = useT();
  const language = useLanguage();
  const [tab, setTab] = useState<Tab>("sounds");
  const [search, setSearch] = useState("");
  // Undefined until main replies
  const [sounds, setSounds] = useState<AlertSound[]>();
  const [media, setMedia] = useState<MediaFile[]>();
  const [soundsFailed, setSoundsFailed] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);

  useIpcRequest(APP_EVENTS.GET_SOUNDS);
  useIpcRequest(APP_EVENTS.GET_MEDIA);

  // Both also reply to an upload or a deletion
  useIpcListener(APP_EVENTS_RESPONSE.GET_SOUNDS, (res) => {
    if (!res) return;
    setSounds(res.data);
    setSoundsFailed(!res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_MEDIA, (res) => {
    if (!res) return;
    setMedia(res.data);
    setMediaFailed(!res.success);
  });

  // The space keeps the tab's name "Sounds 2"
  const label = (name: string, list?: unknown[]) => (
    <>
      {name}
      {list && (
        <>
          {" "}
          <span className={styles.count}>
            {formatStat(list.length, language).full}
          </span>
        </>
      )}
    </>
  );

  const onSounds = tab === "sounds";

  return (
    <Page>
      <div className={styles.library}>
        <Section
          icon={<BackButton to="/alerts" title={t("alerts.library.back")} />}
          title={t("alerts.library.title")}
          description={t("alerts.library.description")}
          actions={
            <>
              <SearchToggle
                placeholder={
                  onSounds
                    ? t("alerts.library.searchSounds")
                    : t("alerts.library.searchMedia")
                }
                value={search}
                onChange={setSearch}
              />
              <Btn
                title={
                  onSounds
                    ? t("alerts.library.addSounds")
                    : t("alerts.library.addMedia")
                }
                onClick={() =>
                  window.api.emit(
                    onSounds
                      ? APP_EVENTS.UPLOAD_SOUNDS
                      : APP_EVENTS.UPLOAD_MEDIA,
                  )
                }
              >
                <FiPlus size={20} />
              </Btn>
            </>
          }
        >
          <Tabs
            tabs={[
              {
                value: "sounds",
                label: label(t("alerts.library.sounds"), sounds),
              },
              {
                value: "media",
                label: label(t("alerts.library.media"), media),
              },
            ]}
            value={tab}
            onChange={setTab}
          />

          {onSounds ? (
            <SoundsTab
              sounds={shown(sounds ?? [], search)}
              empty={!sounds?.length}
              failed={soundsFailed}
            />
          ) : (
            <MediaTab
              media={shown(media ?? [], search)}
              empty={!media?.length}
              failed={mediaFailed}
            />
          )}
        </Section>
      </div>
    </Page>
  );
}
