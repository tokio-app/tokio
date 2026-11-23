import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsResponseMap,
  Gifter,
  LiveHistory,
  LiveSummary,
  PLATFORMS,
} from "@/common/types";
import {
  DateRange,
  inRange,
  PLATFORM_LABELS,
  platformOf,
  platformParts,
} from "@/common/util";
import {
  BackButton,
  Btn,
  ClearHistoryModal,
  DeleteLiveModal,
  Page,
  Section,
  Spinner,
  Tabs,
} from "@/components";
import { formatDate, formatDuration, PLATFORM_ICONS } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useLanguage, useT } from "@/ui/i18n";
import { ReactNode, useEffect, useRef, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import styles from "./coinstats.module.css";
import {
  allTime,
  capitalize,
  DateFilter,
  dateRange,
  historyPlatforms,
  keepSelection,
  NO_FILTER,
  periodText,
  readout,
  StatsTab,
  statsTabs,
} from "./helper";
import { GiftersList, GiftersSection } from "./sections/GiftersSection";
import { ListSection } from "./sections/ListSection";
import { SummarySection } from "./sections/SummarySection";

type LiveReply = AppEventsResponseMap[APP_EVENTS_RESPONSE.LIVE];
type GiftersReply = AppEventsResponseMap[APP_EVENTS_RESPONSE.GIFTERS];

// A search goes this long after the last key, since a wide range of dates
// reads many LIVEs' files
const SEARCH_DELAY_MS = 250;

// The header row, with the dashboard or the spinner under it
function Frame({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Page width="wide">
      <div className={styles.frame}>
        <Section
          icon={<BackButton to="/tools" title={t("tools.back")} />}
          title={t("coinStats.title")}
          actions={actions}
        >
          {children}
        </Section>
      </div>
    </Page>
  );
}

export function CoinStats() {
  const t = useT();
  const language = useLanguage();
  const [history, setHistory] = useState<LiveHistory>();
  // A LIVE's startedAt or null for the totals, undefined until LIVES comes
  const [selected, setSelected] = useState<number | null>();
  // The selected LIVE's gifters come with it
  const [reply, setReply] = useState<LiveReply>();
  const [filter, setFilter] = useState<DateFilter>(NO_FILTER);
  // What the presets count back from: set with the filter, and again when
  // the LIVEs change, so it doesn't move on every render
  const [now, setNow] = useState(Date.now);
  // The filtered dates' gifters, which main adds up from their LIVEs
  const [datesReply, setDatesReply] = useState<GiftersReply>();
  // The gifter search, kept while the selection and the dates change
  const [search, setSearch] = useState("");
  const [searchReply, setSearchReply] = useState<GiftersReply>();
  const [deleting, setDeleting] = useState<LiveSummary>();
  const [clearing, setClearing] = useState(false);
  // The tab picked, kept while the history lacks it
  const [picked, setPicked] = useState<StatsTab>();
  // The next LIVES is another profile's, which starts from its newest LIVE
  const switched = useRef(false);
  // The profile the last GET_PROFILE named. It also comes as a resync (an MCP
  // write), which isn't a switch. The first one counts, since a switch may
  // have come before it.
  const profile = useRef<string | null>(null);

  const range = dateRange(filter, now);
  const visible = (lives: LiveSummary[]) =>
    range ? lives.filter((live) => inRange(live, range)) : lives;
  const shown = visible(history?.lives ?? []);
  // A tab per platform the history has, then All, the first until another
  // is picked. Each platform's counts in its own currency, never added up.
  const platforms = historyPlatforms(history?.lives ?? []);
  const tabs = statsTabs(platforms);
  const tab = picked && tabs.includes(picked) ? picked : tabs[0];
  // A platform's tab lists the LIVEs that were on it
  const tabLives =
    tab === "all" ? shown : shown.filter((l) => platformParts(l)[tab]);
  // One on another platform's tab alone shows the totals
  const live = tabLives.find((l) => l.startedAt === selected);
  // The LIVEs the gifters come from: all of the selected one, or the filter's
  const scope: DateRange = live
    ? { from: live.startedAt, to: live.endedAt }
    : (range ?? {});
  const searching = search.trim() !== "";
  // Replies for other dates, another LIVE or another search are dropped
  const isDates = (res?: GiftersReply) =>
    !!range && !res?.query && res?.from === range.from && res?.to === range.to;
  const isSearch = (res?: GiftersReply) =>
    searching &&
    res?.query === search &&
    res?.from === scope.from &&
    res?.to === scope.to;

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
    setNow(Date.now());
  });

  // Asked again when the dates or the LIVEs change
  const from = range?.from;
  const to = range?.to;
  const filtering = range !== null;
  useEffect(() => {
    if (filtering) window.api.emit(APP_EVENTS.GET_GIFTERS, { from, to });
  }, [filtering, from, to, history]);

  // Main searches every gifter, not just the ones listed
  const scopeFrom = scope.from;
  const scopeTo = scope.to;
  useEffect(() => {
    const timer = searching
      ? setTimeout(() => {
          window.api.emit(APP_EVENTS.GET_GIFTERS, {
            from: scopeFrom,
            to: scopeTo,
            query: search,
          });
        }, SEARCH_DELAY_MS)
      : undefined;
    return () => clearTimeout(timer);
  }, [searching, scopeFrom, scopeTo, search, history]);

  useIpcListener(APP_EVENTS_RESPONSE.GIFTERS, (res) => {
    if (isSearch(res)) setSearchReply(res);
    else if (isDates(res)) setDatesReply(res);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success || res.profile?.name === profile.current) return;
    profile.current = res.profile?.name ?? null;
    switched.current = true;
    // The last profile's, which the same dates or search would still match
    setDatesReply(undefined);
    setSearchReply(undefined);
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
      <Frame>
        <div className={styles.loading}>
          <Spinner size={20} />
        </div>
      </Frame>
    );
  }

  // A list's gifters on the tab's platform, in main's order and with its
  // ranks. All ranks none.
  const paid = <G extends Gifter>(list?: G[]) =>
    list?.filter((g) => platformOf(g) === tab);

  const dates = isDates(datesReply) ? datesReply : undefined;
  const total = allTime(tabLives, range ?? {});
  // Main adds up the gifts in the dates of a LIVE they cut
  const parts = dates?.totals ? platformParts(dates.totals) : total.parts;
  // The first row's: the tab's money, or every gift on All
  const amount =
    tab === "all"
      ? Object.values(parts).reduce((n, part) => n + part.gifts, 0)
      : (parts[tab]?.amount ?? 0);

  // The gifters panel: a search's matches, or the selection's gifters
  const gifters = (): GiftersList => {
    if (searching) {
      const found = isSearch(searchReply) ? searchReply : undefined;
      return {
        gifters: paid(found?.data),
        empty: t("coinStats.gifters.noMatch", { query: search.trim() }),
        failed:
          found?.success === false
            ? t("coinStats.gifters.failedSearch")
            : undefined,
      };
    }
    if (live) {
      const got = reply?.startedAt === live.startedAt ? reply : undefined;
      return {
        gifters: paid(got?.data?.gifters),
        empty: t("coinStats.gifters.empty"),
        failed:
          got?.success === false ? t("coinStats.gifters.failed") : undefined,
      };
    }
    if (range) {
      return {
        gifters: paid(dates?.data),
        empty: t("coinStats.gifters.emptyDates"),
        failed:
          dates?.success === false
            ? t("coinStats.gifters.failedDates")
            : undefined,
      };
    }
    return {
      gifters: paid(history.gifters),
      empty: t("coinStats.gifters.empty"),
    };
  };

  return (
    <>
      {deleting && (
        <DeleteLiveModal
          item={deleting}
          onClose={() => setDeleting(undefined)}
        />
      )}
      {clearing && <ClearHistoryModal onClose={() => setClearing(false)} />}

      <Frame>
        {tabs.length > 1 && (
          <Tabs
            className={styles.tabs}
            label={t("coinStats.platform")}
            tabs={tabs.map((value) => {
              if (value === "all") return { value, label: t("coinStats.all") };
              const Icon = PLATFORM_ICONS[value];
              return {
                value,
                icon: <Icon aria-hidden />,
                label: PLATFORM_LABELS[value],
              };
            })}
            value={tab}
            onChange={setPicked}
          />
        )}
        <div className={styles.dashboard}>
          {/* Swapped at once on a new selection, with no motion */}
          <div className={styles.column}>
            {live ? (
              <SummarySection
                title={capitalize(
                  formatDate(live.startedAt, language, "long"),
                  language,
                )}
                lines={[
                  t("coinStats.live.times", {
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
                    title={t("coinStats.live.delete")}
                    onClick={() => setDeleting(live)}
                  >
                    <FiTrash2 size={18} />
                  </Btn>
                }
                // On All, the platforms it was on
                stats={readout(
                  tab,
                  PLATFORMS.filter((p) => platformParts(live)[p]),
                  platformParts(live),
                )}
              />
            ) : (
              <SummarySection
                title={periodText(filter, language, now)}
                lines={[
                  t("coinStats.allTime.count", { count: tabLives.length }),
                  t("coinStats.allTime.length", {
                    length: formatDuration(total.length),
                  }),
                ]}
                // Clearing takes every LIVE, so only All time offers it
                action={
                  !range && (
                    <Btn
                      variant="icon"
                      title={t("coinStats.allTime.clear")}
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
                stats={readout(tab, platforms, parts)}
              />
            )}
            {/* One in both cases, so an open search stays open */}
            <GiftersSection
              title={t(
                live ? "coinStats.gifters.title" : "coinStats.gifters.top",
              )}
              {...gifters()}
              platform={tab === "all" ? null : tab}
              search={search}
              onSearch={setSearch}
            />
          </div>

          <ListSection
            lives={tabLives}
            title={periodText(filter, language, now)}
            amount={amount}
            tab={tab}
            filter={filter}
            filtered={!!range}
            selected={live ? live.startedAt : null}
            onSelect={setSelected}
            onFilter={(next) => {
              setFilter(next);
              setNow(Date.now());
              // New dates open on their totals
              setSelected(null);
            }}
          />
        </div>
      </Frame>
    </>
  );
}
