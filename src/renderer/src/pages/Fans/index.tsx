import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Fan,
  Platform,
  PLATFORMS,
} from "@/common/types";
import {
  defaultProfile,
  PLATFORM_LABELS,
  platformOf,
  viewerMatcher,
} from "@/common/util";
import {
  BackButton,
  EmptyState,
  Page,
  SearchToggle,
  Section,
  Spinner,
  Tabs,
  Toggle,
} from "@/components";
import { cx, formatDate } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { PLATFORM_ICONS } from "@/pages/Home/helper";
import { useLanguage, useT } from "@/ui/i18n";
import { useState } from "react";
import styles from "./fans.module.css";

type FansTab = Platform | "all";

export function Fans() {
  const t = useT();
  const language = useLanguage();
  // Each platform's in main's order: TikTok's by level, the others' by
  // months, then the most recently seen
  const [fans, setFans] = useState<Fan[]>();
  const [platforms, setPlatforms] = useState(defaultProfile.platforms);
  const [picked, setPicked] = useState<FansTab>();
  const [search, setSearch] = useState("");
  const [superfansOnly, setSuperfansOnly] = useState(false);
  // Badges that didn't load. A few files serve every fan, so one is enough.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  // The fans come after the profile, and again on each switch. A failed
  // reply still asks, so the list never waits on the profile.
  useIpcRequest(APP_EVENTS.GET_PROFILE);

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (res?.success && res.profile) setPlatforms(res.profile.platforms);
    window.api.emit(APP_EVENTS.GET_FANS);
  });

  useIpcListener(APP_EVENTS_RESPONSE.FANS, (res) => {
    if (res) setFans(res.data);
  });

  // The profile's platforms and any a saved fan is on, then All with two or
  // more. The picked one is kept while it's there.
  const tabPlatforms = PLATFORMS.filter(
    (p) => platforms.includes(p) || fans?.some((fan) => platformOf(fan) === p),
  );
  const tabs: FansTab[] =
    tabPlatforms.length > 1 ? [...tabPlatforms, "all"] : tabPlatforms;
  const tab = picked && tabs.includes(picked) ? picked : tabs[0];
  const tiktok = tab === "tiktok";

  const query = search.trim();
  // An empty search names everyone
  const named = viewerMatcher(query);
  const onTab =
    tab === "all"
      ? // Nothing ranked across platforms: the most recently seen first
        fans && [...fans].sort((a, b) => b.seenAt - a.seenAt)
      : fans?.filter((fan) => platformOf(fan) === tab);
  const shown = onTab?.filter(
    (fan) => (!tiktok || !superfansOnly || fan.superfan) && named(fan),
  );

  const empty = () => {
    if (query) return t("fans.noMatch", { query });
    if (tab === "all") return t("fans.emptyAll");
    if (tab === "youtube") return t("fans.emptyMembers");
    if (tab !== "tiktok") return t("fans.emptySubscribers");
    return superfansOnly ? t("fans.noSuperfans") : t("fans.empty");
  };

  // A TikTok fan's level, with its badge on their own tab
  const level = (fan: Fan) => (
    <>
      {tiktok && fan.fanBadge && !broken.has(fan.fanBadge) && (
        <img
          className={styles.badge}
          src={fan.fanBadge}
          alt=""
          onError={() => setBroken((all) => new Set(all).add(fan.fanBadge))}
        />
      )}
      <span className={styles.number} aria-hidden>
        {fan.fanLevel}
      </span>
      <span className={styles.hidden}>
        {t("fans.level", { level: String(fan.fanLevel) })}
      </span>
    </>
  );

  // Another platform's months, the number in bold, else what they are there
  const months = (fan: Fan) => {
    if (fan.months === undefined) {
      return (
        <span className={styles.kind}>
          {t(platformOf(fan) === "youtube" ? "fans.member" : "fans.subscriber")}
        </span>
      );
    }
    const text = t("fans.months", { count: fan.months });
    const count = String(fan.months);
    const at = text.indexOf(count);
    return (
      <span className={styles.months}>
        {text.slice(0, at)}
        <span className={styles.number}>{count}</span>
        {text.slice(at + count.length)}
      </span>
    );
  };

  let content;
  if (!shown) {
    content = (
      <div className={styles.loading}>
        <Spinner size={20} />
      </div>
    );
  } else if (shown.length === 0) {
    content = <EmptyState>{empty()}</EmptyState>;
  } else {
    content = (
      <ul
        className={cx(
          styles.list,
          tab === "all" ? styles.all : !tiktok && styles.wide,
        )}
        aria-label={t("fans.title")}
      >
        {shown.map((fan) => {
          const platform = platformOf(fan);
          const Icon = PLATFORM_ICONS[platform];
          return (
            <li key={`${platform}:${fan.userId}`} className={styles.fan}>
              {/* TikTok's and All's lead with a slot for the badge or the
                  platform's icon, so the numbers line up */}
              <span
                className={cx(
                  styles.lead,
                  (tiktok || tab === "all") && styles.slotted,
                )}
              >
                {tab === "all" && (
                  <Icon
                    className={styles.icon}
                    title={PLATFORM_LABELS[platform]}
                  />
                )}
                {platform === "tiktok" ? level(fan) : months(fan)}
              </span>
              {/* The handle when TikTok sent no nickname, as Home's feed does */}
              <span className={styles.who}>
                <span className={styles.headline}>
                  <span className={styles.name}>
                    {fan.username || fan.handle}
                  </span>
                  {/* Every other platform's fan is a subscriber */}
                  {platform === "tiktok" && fan.superfan && (
                    <span className={styles.superfan}>
                      {t("fans.superfan")}
                    </span>
                  )}
                </span>
                <span className={styles.handle}>{`@${fan.handle}`}</span>
              </span>
              <span className={styles.seen}>
                {t("fans.seen", {
                  date: formatDate(fan.seenAt, language, "short"),
                })}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  const several = tabs.length > 1;
  // TikTok's alone: in the header with one platform, else by the tabs
  const only = (
    <Toggle
      className={styles.only}
      label={t("fans.superfansOnly")}
      checked={superfansOnly}
      onChange={(e) => setSuperfansOnly(e.target.checked)}
    />
  );

  return (
    <Page>
      <div className={styles.fans}>
        <Section
          icon={<BackButton to="/tools" title={t("tools.back")} />}
          title={t("fans.title")}
          description={t("fans.description")}
          actions={
            <>
              <SearchToggle
                placeholder={t("fans.search")}
                value={search}
                onChange={setSearch}
              />
              {!several && tiktok && only}
            </>
          }
        >
          {several && (
            // The switch at the row's end, as Home's + beside its tabs
            <div className={styles.tab_row}>
              <Tabs
                className={styles.tabs}
                label={t("fans.platform")}
                tabs={tabs.map((value) => {
                  if (value === "all") return { value, label: t("fans.all") };
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
              {tiktok && only}
            </div>
          )}
          {content}
        </Section>
      </div>
    </Page>
  );
}
