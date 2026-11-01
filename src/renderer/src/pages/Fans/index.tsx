import { APP_EVENTS, APP_EVENTS_RESPONSE, Fan } from "@/common/types";
import { viewerMatcher } from "@/common/util";
import {
  BackButton,
  EmptyState,
  Page,
  SearchToggle,
  Section,
  Spinner,
} from "@/components";
import { formatDate } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useLanguage, useT } from "@/ui/i18n";
import { useState } from "react";
import styles from "./fans.module.css";

export function Fans() {
  const t = useT();
  const language = useLanguage();
  // The highest level first, then the most recently seen, as main sorts them
  const [fans, setFans] = useState<Fan[]>();
  const [search, setSearch] = useState("");
  // Badges that didn't load. A few files serve every fan, so one is enough.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  useIpcRequest(APP_EVENTS.GET_FANS);

  useIpcListener(APP_EVENTS_RESPONSE.FANS, (res) => {
    if (res) setFans(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (res?.success) window.api.emit(APP_EVENTS.GET_FANS);
  });

  const query = search.trim();
  const shown = query ? fans?.filter(viewerMatcher(query)) : fans;

  let content;
  if (!shown) {
    content = (
      <div className={styles.loading}>
        <Spinner size={20} />
      </div>
    );
  } else if (shown.length === 0) {
    content = (
      <EmptyState>
        {query ? t("fans.noMatch", { query }) : t("fans.empty")}
      </EmptyState>
    );
  } else {
    content = (
      <ul className={styles.list} aria-label={t("fans.title")}>
        {shown.map((fan) => (
          <li key={fan.userId} className={styles.fan}>
            <span className={styles.level}>
              {fan.fanBadge && !broken.has(fan.fanBadge) && (
                <img
                  className={styles.badge}
                  src={fan.fanBadge}
                  alt=""
                  onError={() =>
                    setBroken((all) => new Set(all).add(fan.fanBadge))
                  }
                />
              )}
              <span className={styles.number} aria-hidden>
                {fan.fanLevel}
              </span>
              <span className={styles.hidden}>
                {t("fans.level", { level: String(fan.fanLevel) })}
              </span>
            </span>
            {/* The handle when TikTok sent no nickname, as Home's feed does */}
            <span className={styles.who}>
              <span className={styles.name}>{fan.username || fan.handle}</span>
              <span className={styles.handle}>{`@${fan.handle}`}</span>
            </span>
            <span className={styles.seen}>
              {t("fans.seen", {
                date: formatDate(fan.seenAt, language, "short"),
              })}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Page>
      <div className={styles.fans}>
        <Section
          icon={<BackButton to="/tools" title={t("tools.back")} />}
          title={t("fans.title")}
          description={t("fans.description")}
          actions={
            <SearchToggle
              placeholder={t("fans.search")}
              value={search}
              onChange={setSearch}
            />
          }
        >
          {content}
        </Section>
      </div>
    </Page>
  );
}
