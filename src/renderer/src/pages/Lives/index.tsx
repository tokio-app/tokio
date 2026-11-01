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
import {
  allTime,
  capitalize,
  DateFilter,
  dateRange,
  inRange,
  keepSelection,
  NO_FILTER,
  periodText,
} from "./helper";
import { GiftersSection } from "./sections/GiftersSection";
import { ListSection } from "./sections/ListSection";
import { SummarySection } from "./sections/SummarySection";

type LiveReply = AppEventsResponseMap[APP_EVENTS_RESPONSE.LIVE];
type GiftersReply = AppEventsResponseMap[APP_EVENTS_RESPONSE.GIFTERS];

export function Lives() {
  const t = useT();
  const language = useLanguage();
  const [history, setHistory] = useState<LiveHistory>();
  // A LIVE's startedAt or null for the totals, undefined until LIVES comes
  const [selected, setSelected] = useState<number | null>();
  // The selected LIVE's gifters come with it
  const [reply, setReply] = useState<LiveReply>();
  const [filter, setFilter] = useState<DateFilter>(NO_FILTER);
  // The filtered dates' gifters, which main adds up from their LIVEs
  const [datesReply, setDatesReply] = useState<GiftersReply>();
  const [deleting, setDeleting] = useState<LiveSummary>();
  const [clearing, setClearing] = useState(false);
  // The next LIVES is another profile's, which starts from its newest LIVE
  const switched = useRef(false);

  const range = dateRange(filter);
  const visible = (lives: LiveSummary[]) =>
    range ? lives.filter((live) => inRange(live, range)) : lives;
  const isDates = (res?: GiftersReply) =>
    !!range && res?.from === range.from && res?.to === range.to;

  useIpcRequest(APP_EVENTS.GET_LIVES);

  // Pushed again when a LIVE ends
  useIpcListener(APP_EVENTS_RESPONSE.LIVES, (res) => {
    if (!res) return;
    const fresh = switched.current;
    switched.current = false;
    setSelected(
      keepSelection(
        fresh ? undefined : selected,
        fresh ? [] : visible(history?.lives ?? []),
        visible(res.data.lives),
      ),
    );
    setHistory(res.data);
  });

  // Asked again when the dates or the LIVEs change
  const from = range?.from;
  const to = range?.to;
  const filtering = range !== null;
  useEffect(() => {
    if (filtering) window.api.emit(APP_EVENTS.GET_GIFTERS, { from, to });
  }, [filtering, from, to, history]);

  // A late reply for other dates is dropped
  useIpcListener(APP_EVENTS_RESPONSE.GIFTERS, (res) => {
    if (isDates(res)) setDatesReply(res);
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

  const shown = visible(history.lives);
  const live = shown.find((l) => l.startedAt === selected);
  const total = allTime(shown);

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
                  failed={
                    reply?.startedAt === live.startedAt && !reply.success
                      ? "lives.gifters.failed"
                      : undefined
                  }
                />
              </>
            ) : (
              <>
                <SummarySection
                  title={periodText(filter, language)}
                  lines={[
                    t("lives.allTime.count", { count: shown.length }),
                    t("lives.allTime.length", {
                      length: formatDuration(total.length),
                    }),
                  ]}
                  // Clearing takes every LIVE, so only All time offers it
                  action={
                    !range && (
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
                    )
                  }
                  totals={total}
                />
                {range ? (
                  <GiftersSection
                    title={t("lives.gifters.top")}
                    gifters={isDates(datesReply) ? datesReply?.data : undefined}
                    empty="lives.gifters.emptyDates"
                    failed={
                      isDates(datesReply) && !datesReply?.success
                        ? "lives.gifters.failedDates"
                        : undefined
                    }
                  />
                ) : (
                  <GiftersSection
                    title={t("lives.gifters.top")}
                    gifters={history.gifters}
                  />
                )}
              </>
            )}
          </div>

          <ListSection
            lives={shown}
            title={periodText(filter, language)}
            coins={total.coins}
            filter={filter}
            filtered={!!range}
            selected={live ? live.startedAt : null}
            onSelect={setSelected}
            onFilter={(next) => {
              setFilter(next);
              // New dates open on their totals
              setSelected(null);
            }}
          />
        </div>
      </Page>
    </>
  );
}
