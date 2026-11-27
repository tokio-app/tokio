import { MessageKey, translate } from "@/common/i18n";
import { Gifter, Platform, RankedGifter, TOKIO_EVENTS } from "@/common/types";
import { Currency, PLATFORM_CURRENCY, triggersFor } from "@/common/util";
import {
  Avatar,
  EmptyState,
  SearchToggle,
  Section,
  Spinner,
  tabPanel,
  Tabs,
} from "@/components";
import { cx } from "@/helper/cx";
import { amountLabel, giftsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import { useId } from "react";
import styles from "../coinstats.module.css";

// What a list ranks: the platform's money, or gifted subs
export type Ranking = "amount" | "subs";

// Each top, named by what it ranks as Home names it, with the switch's
// label and what it says with no one on it: in the whole history or a
// LIVE, then in some dates
const TOPS: Record<
  Currency | "subs",
  { title: MessageKey; tab: MessageKey; empty: MessageKey; dates: MessageKey }
> = {
  coins: {
    title: "coinStats.gifters.top",
    tab: "coinStats.stats.coins",
    empty: "coinStats.gifters.empty",
    dates: "coinStats.gifters.emptyDates",
  },
  kicks: {
    title: "coinStats.gifters.kicks",
    tab: "coinStats.stats.kicks",
    empty: "coinStats.gifters.emptyKicks",
    dates: "coinStats.gifters.emptyDatesKicks",
  },
  bits: {
    title: "coinStats.gifters.bits",
    tab: "coinStats.stats.bits",
    empty: "coinStats.gifters.emptyBits",
    dates: "coinStats.gifters.emptyDatesBits",
  },
  usd: {
    title: "coinStats.gifters.superChats",
    tab: "coinStats.stats.superChats",
    empty: "coinStats.gifters.emptySuperChats",
    dates: "coinStats.gifters.emptyDatesSuperChats",
  },
  subs: {
    title: "coinStats.gifters.subs",
    tab: "coinStats.stats.giftSubs",
    empty: "coinStats.gifters.emptySubs",
    dates: "coinStats.gifters.emptyDatesSubs",
  },
};

const topOf = (platform: Platform, by: Ranking) =>
  TOPS[by === "subs" ? "subs" : PLATFORM_CURRENCY[platform]];

export interface GiftersList {
  // One platform's in the ranking shown, the most first, undefined until
  // main sends them. Main's come with their place among all of that
  // platform's in it.
  gifters?: (Gifter | RankedGifter)[];
  // Some dates', which say so when there are none
  dated?: boolean;
  // What to say when there are none instead of the ranking's own (a
  // search's)
  empty?: string;
  // What to say when main couldn't send them, after its notice
  failed?: string;
}

interface Props extends GiftersList {
  // Whose gifters, null on All, which would rank one currency against
  // another
  platform: Platform | null;
  by: Ranking;
  onBy: (by: Ranking) => void;
  search: string;
  // None while there's nothing to search
  onSearch?: (search: string) => void;
}

// What each of the platform's gifters sent in the ranking's unit: their
// money, with their gifts where it sends them, or their gifted subs
function sentParts(
  platform: Platform,
  by: Ranking,
  gifter: Gifter,
  language: string,
) {
  if (by === "subs")
    return [translate(language, "gifts.giftSubs", { count: gifter.giftSubs })];
  return [
    amountLabel(gifter.coins, PLATFORM_CURRENCY[platform], language),
    triggersFor([platform]).includes(TOKIO_EVENTS.GIFT) &&
      giftsLabel(gifter.gifts, language),
  ].filter((part) => part !== false);
}

export function GiftersSection({
  gifters,
  dated,
  empty,
  failed,
  platform,
  by,
  onBy,
  search,
  onSearch,
}: Props) {
  const t = useT();
  const panelId = useId();
  const language = useLanguage();
  const top = platform && topOf(platform, by);
  const title = t(top ? top.title : "coinStats.gifters.top");
  // Twitch, YouTube and Kick rank their money and their gifted subs apart
  const subs =
    !!platform && triggersFor([platform]).includes(TOKIO_EVENTS.GIFT_SUB);

  let content;
  if (!platform || !top) {
    content = <EmptyState>{t("coinStats.gifters.pickPlatform")}</EmptyState>;
  } else if (failed) {
    content = <EmptyState>{failed}</EmptyState>;
  } else if (!gifters) {
    content = (
      <div className={styles.loading}>
        <Spinner size={20} />
      </div>
    );
  } else if (gifters.length === 0) {
    content = (
      <EmptyState>{empty ?? t(dated ? top.dates : top.empty)}</EmptyState>
    );
  } else {
    content = (
      <ol
        className={cx(styles.gifters, by === "subs" && styles.subs)}
        aria-label={title}
      >
        {gifters.map((gifter, i) => (
          <li key={gifter.userId} className={styles.gifter}>
            <span className={styles.rank}>
              {"rank" in gifter ? gifter.rank : i + 1}
            </span>
            {/* The handle when TikTok sent no nickname, as Home's feed does */}
            <Avatar
              name={gifter.username || gifter.handle}
              picture={gifter.picture}
            />
            <span className={styles.who}>
              <span className={styles.name}>
                {gifter.username || gifter.handle}
              </span>
              <span className={styles.handle}>{`@${gifter.handle}`}</span>
            </span>
            {sentParts(platform, by, gifter, language).map((part, n) => (
              <span key={n} className={styles.amount}>
                {part}
              </span>
            ))}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <Section
      title={title}
      // A search ranks too, so it waits for a platform
      actions={
        platform &&
        onSearch && (
          <SearchToggle
            placeholder={t("coinStats.gifters.search")}
            value={search}
            onChange={onSearch}
          />
        )
      }
    >
      {platform && subs && (
        <Tabs
          variant="pill"
          className={styles.ranking}
          label={t("coinStats.gifters.by")}
          tabs={(["amount", "subs"] as const).map((value) => ({
            value,
            label: t(topOf(platform, value).tab),
          }))}
          value={by}
          onChange={onBy}
          panelId={panelId}
        />
      )}
      {platform && subs ? (
        <div {...tabPanel(panelId, by)} className={styles.ranked}>
          {content}
        </div>
      ) : (
        content
      )}
    </Section>
  );
}
