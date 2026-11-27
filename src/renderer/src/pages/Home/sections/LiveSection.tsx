import { MessageKey } from "@/common/i18n";
import { Gifter, LiveSession, Platform } from "@/common/types";
import { Currency } from "@/common/util";
import { Avatar, Section } from "@/components";
import { amountLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import styles from "../home.module.css";
import { LiveGifters, liveView, HomeTab, Views } from "../helper";
import { StatValue } from "./StatValue";
import { ViewersChart } from "./ViewersChart";

// The tiles in a row, as home.module.css's .stats sets it
const STATS_ROW = 6;

// Each currency's top, named by what it ranks: TikTok's and YouTube's
// gifts, Kick's Kicks, Twitch's Bits, YouTube's Super Chats
const MONEY_TOPS: Record<Currency, { title: MessageKey; empty: MessageKey }> = {
  coins: { title: "home.gifters.title", empty: "home.gifters.empty" },
  jewels: { title: "home.gifters.title", empty: "home.gifters.empty" },
  kicks: { title: "home.gifters.kicks", empty: "home.gifters.emptyKicks" },
  bits: { title: "home.gifters.bits", empty: "home.gifters.emptyBits" },
  usd: {
    title: "home.gifters.superChats",
    empty: "home.gifters.emptySuperChats",
  },
};

interface Props {
  // The tab picked above: a platform in the LIVE, or all of them
  tab: HomeTab;
  // The platforms in the LIVE, which All adds up
  platforms: Platform[];
  session: LiveSession;
  views: Views;
  // TikTok's
  likes: number;
  gifters: LiveGifters;
}

// Only while LIVE: the viewers and their line, the numbers and top gifters
// of the tab's platform, or of all of them
export function LiveSection({ tab, platforms, ...numbers }: Props) {
  const t = useT();
  const language = useLanguage();
  const { viewers, minutes, stats, gifters, subGifters } = liveView(
    tab,
    platforms,
    numbers,
  );

  return (
    <div className={styles.live}>
      <div className={styles.pulse}>
        <div className={styles.hero}>
          <StatValue value={viewers} className={styles.hero_value} />
          <span className={styles.stat_label}>{t("home.stats.viewers")}</span>
        </div>
        <ViewersChart viewers={minutes} liveCount={viewers} />
      </div>

      <div
        className={styles.stats}
        // Past a row of six, two even rows: 4 and 3, 4 and 4, 5 and 4
        style={
          stats.length > STATS_ROW
            ? {
                gridTemplateColumns: `repeat(${Math.ceil(stats.length / 2)}, minmax(0, 1fr))`,
              }
            : undefined
        }
      >
        {stats.map(({ label, value, money }) => (
          <div key={label} className={styles.stat}>
            <StatValue
              value={value}
              money={money}
              className={styles.stat_value}
            />
            <span className={styles.stat_label}>{t(label)}</span>
          </div>
        ))}
      </div>

      {gifters && (
        <div className={styles.tops}>
          <TopList
            title={t(MONEY_TOPS[gifters.currency].title)}
            empty={t(MONEY_TOPS[gifters.currency].empty)}
            list={gifters.list}
            label={(g) => amountLabel(g.coins, gifters.currency, language)}
          />
          {subGifters && (
            <TopList
              title={t("home.gifters.subs")}
              empty={t("home.gifters.emptySubs")}
              list={subGifters}
              label={(g) => t("gifts.giftSubs", { count: g.giftSubs })}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface TopProps {
  title: string;
  // Said while no one is on it
  empty: string;
  // The most first
  list: Gifter[];
  // What each one sent, in the top's unit
  label: (gifter: Gifter) => string;
}

// A top's first three, in a row
function TopList({ title, empty, list, label }: TopProps) {
  return (
    <Section title={title}>
      {list.length === 0 ? (
        <p className={styles.quiet}>{empty}</p>
      ) : (
        <ol className={styles.gifters} aria-label={title}>
          {list.slice(0, 3).map((gifter, i) => {
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
                  <span className={styles.gifter_coins}>{label(gifter)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
