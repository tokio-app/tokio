import { LiveSession, Platform } from "@/common/types";
import { PLATFORM_LABELS } from "@/common/util";
import { Avatar, Section, Tabs } from "@/components";
import { formatStat } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import { useState } from "react";
import styles from "../home.module.css";
import {
  LiveGifters,
  liveView,
  PLATFORM_ICONS,
  StatsTab,
  Views,
} from "../helper";
import { ViewersChart } from "./ViewersChart";

interface Props {
  // The platforms in the LIVE, a tab each before All. One gets no tabs.
  platforms: Platform[];
  session: LiveSession;
  views: Views;
  // TikTok's
  likes: number;
  gifters: LiveGifters;
}

// Short, with the exact number on hover, as the language writes them
function StatValue({ value, className }: { value: number; className: string }) {
  const language = useLanguage();
  const { short, full } = formatStat(value, language);
  return (
    <span className={className} title={full}>
      {short}
    </span>
  );
}

// Only while LIVE: the viewers and their line, the numbers and top gifters,
// for one platform or all of them
export function LiveSection({ platforms, ...numbers }: Props) {
  const t = useT();
  const language = useLanguage();
  const [picked, setPicked] = useState<StatsTab | null>(null);
  // The first platform until another tab is picked, or the picked one is gone
  const tab: StatsTab =
    platforms.length < 2
      ? "all"
      : picked === "all" || (picked && platforms.includes(picked))
        ? picked
        : platforms[0];
  const { viewers, minutes, stats, gifters } = liveView(
    tab,
    platforms,
    numbers,
  );
  // Each tab says its viewers now, so every platform's show at once
  const tabLabel = (name: string, count: number) => (
    <>
      {name}
      <StatValue value={count} className={styles.tab_count} />
    </>
  );

  return (
    <div className={styles.live}>
      {platforms.length > 1 && (
        <Tabs
          tabs={[
            ...platforms.map((platform) => {
              const Icon = PLATFORM_ICONS[platform];
              return {
                value: platform,
                icon: <Icon aria-hidden="true" />,
                label: tabLabel(
                  PLATFORM_LABELS[platform],
                  numbers.views.platformViewers[platform] ?? 0,
                ),
              };
            }),
            {
              value: "all" as const,
              label: tabLabel(t("home.stats.all"), numbers.views.current),
            },
          ]}
          value={tab}
          onChange={setPicked}
        />
      )}

      <div className={styles.pulse}>
        <div className={styles.hero}>
          <StatValue value={viewers} className={styles.hero_value} />
          <span className={styles.stat_label}>{t("home.stats.viewers")}</span>
        </div>
        <ViewersChart viewers={minutes} liveCount={viewers} />
      </div>

      <div className={styles.stats}>
        {stats.map(({ label, value }) => (
          <div key={label} className={styles.stat}>
            <StatValue value={value} className={styles.stat_value} />
            <span className={styles.stat_label}>{t(label)}</span>
          </div>
        ))}
      </div>

      {gifters && (
        <Section title={t("home.gifters.title")}>
          {gifters.length === 0 ? (
            <p className={styles.quiet}>{t("home.gifters.empty")}</p>
          ) : (
            <ol className={styles.gifters} aria-label={t("home.gifters.title")}>
              {gifters.slice(0, 3).map((gifter, i) => {
                const name = gifter.username || gifter.handle;
                return (
                  <li key={gifter.userId} className={styles.gifter}>
                    {/* The list's order already says it to screen readers */}
                    <span className={styles.rank} aria-hidden="true">
                      {i + 1}
                    </span>
                    <Avatar name={name} picture={gifter.picture} />
                    <span className={styles.gifter_body}>
                      <span
                        className={styles.gifter_name}
                        title={`@${gifter.handle}`}
                      >
                        {name}
                      </span>
                      <span className={styles.gifter_coins}>
                        {coinsLabel(gifter.live.coins, language)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      )}
    </div>
  );
}
