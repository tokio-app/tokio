import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsResponseMap,
  LiveHistory,
  LiveSummary,
} from "@/common/types";
import {
  Btn,
  ClearHistoryModal,
  DeleteLiveModal,
  Page,
  Spinner,
} from "@/components";
import { formatDate, formatDuration } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useLanguage, useT } from "@/ui/i18n";
import { useEffect, useRef, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import styles from "./lives.module.css";
import { allTime, capitalize, keepSelection } from "./helper";
import { GiftersSection } from "./sections/GiftersSection";
import { ListSection } from "./sections/ListSection";
import { SummarySection } from "./sections/SummarySection";

type LiveReply = AppEventsResponseMap[APP_EVENTS_RESPONSE.LIVE];

export function Lives() {
  const t = useT();
  const language = useLanguage();
  const [history, setHistory] = useState<LiveHistory>();
  // A LIVE's startedAt or null for All time, undefined until LIVES comes
  const [selected, setSelected] = useState<number | null>();
  // The selected LIVE's gifters come with it
  const [reply, setReply] = useState<LiveReply>();
  const [deleting, setDeleting] = useState<LiveSummary>();
  const [clearing, setClearing] = useState(false);
  // The next LIVES is another profile's, which starts from its newest LIVE
  const switched = useRef(false);

  useIpcRequest(APP_EVENTS.GET_LIVES);

  // Pushed again when a LIVE ends
  useIpcListener(APP_EVENTS_RESPONSE.LIVES, (res) => {
    if (!res) return;
    const fresh = switched.current;
    switched.current = false;
    setSelected(
      keepSelection(
        fresh ? undefined : selected,
        fresh ? [] : (history?.lives ?? []),
        res.data.lives,
      ),
    );
    setHistory(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success) return;
    switched.current = true;
    window.api.emit(APP_EVENTS.GET_LIVES);
  });

  useEffect(() => {
    if (selected != null) {
      window.api.emit(APP_EVENTS.GET_LIVE, { startedAt: selected });
    }
  }, [selected]);

  // A late reply for a LIVE no longer selected is dropped
  useIpcListener(APP_EVENTS_RESPONSE.LIVE, (res) => {
    if (res?.startedAt === selected) setReply(res);
  });

  if (!history) {
    return (
      <Page width="wide">
        <div className={styles.loading}>
          <Spinner size={20} />
        </div>
      </Page>
    );
  }

  const live = history.lives.find((l) => l.startedAt === selected);
  const total = allTime(history.lives);

  return (
    <>
      {deleting && (
        <DeleteLiveModal
          item={deleting}
          onClose={() => setDeleting(undefined)}
        />
      )}
      {clearing && <ClearHistoryModal onClose={() => setClearing(false)} />}

      <Page width="wide">
        <div className={styles.dashboard}>
          {/* Swapped at once on a new selection, with no motion */}
          <div className={styles.column}>
            {live ? (
              <>
                <SummarySection
                  title={capitalize(
                    formatDate(live.startedAt, language, "long"),
                    language,
                  )}
                  lines={[
                    t("lives.live.times", {
                      start: formatDate(live.startedAt, language, "time"),
                      end: formatDate(live.endedAt, language, "time"),
                    }),
                    formatDuration(live.endedAt - live.startedAt),
                    // Empty only for a LIVE no connect started
                    ...(live.username ? [`@${live.username}`] : []),
                  ]}
                  action={
                    <Btn
                      variant="icon"
                      title={t("lives.live.delete")}
                      onClick={() => setDeleting(live)}
                    >
                      <FiTrash2 size={18} />
                    </Btn>
                  }
                  totals={live}
                />
                <GiftersSection
                  title={t("lives.gifters.title")}
                  gifters={
                    reply?.startedAt === live.startedAt
                      ? reply.data?.gifters
                      : undefined
                  }
                  failed={reply?.startedAt === live.startedAt && !reply.success}
                />
              </>
            ) : (
              <>
                <SummarySection
                  title={t("lives.allTime.title")}
                  lines={[
                    t("lives.allTime.count", { count: history.lives.length }),
                    t("lives.allTime.length", {
                      length: formatDuration(total.length),
                    }),
                  ]}
                  action={
                    <Btn
                      variant="icon"
                      title={t("lives.allTime.clear")}
                      disabled={
                        history.lives.length === 0 &&
                        history.gifters.length === 0
                      }
                      onClick={() => setClearing(true)}
                    >
                      <FiTrash2 size={18} />
                    </Btn>
                  }
                  totals={total}
                />
                <GiftersSection
                  title={t("lives.gifters.top")}
                  gifters={history.gifters}
                />
              </>
            )}
          </div>

          <ListSection
            lives={history.lives}
            coins={total.coins}
            selected={live ? live.startedAt : null}
            onSelect={setSelected}
          />
        </div>
      </Page>
    </>
  );
}
