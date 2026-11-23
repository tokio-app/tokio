import { translate } from "@/common/i18n";
import { Gifter, Platform, RankedGifter, TOKIO_EVENTS } from "@/common/types";
import { PLATFORM_CURRENCY, triggersFor } from "@/common/util";
import {
  Avatar,
  EmptyState,
  SearchToggle,
  Section,
  Spinner,
} from "@/components";
import { amountLabel, giftsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import styles from "../coinstats.module.css";

export interface GiftersList {
  // One platform's, the most first, undefined until main sends them. A
  // search's come with their place among all of that platform's.
  gifters?: (Gifter | RankedGifter)[];
  // What to say when there are none
  empty: string;
  // What to say when main couldn't send them, after its notice
  failed?: string;
}

interface Props extends GiftersList {
  title: string;
  // Whose gifters, null on All, which would rank one currency against
  // another
  platform: Platform | null;
  search: string;
  onSearch: (search: string) => void;
}

// What each of the platform's gifters sent: their money, then their gifts
// and gifted subs where it sends them
function sentParts(platform: Platform, gifter: Gifter, language: string) {
  const sent = triggersFor([platform]);
  return [
    amountLabel(gifter.coins, PLATFORM_CURRENCY[platform], language),
    sent.includes(TOKIO_EVENTS.GIFT) && giftsLabel(gifter.gifts, language),
    sent.includes(TOKIO_EVENTS.GIFT_SUB) &&
      translate(language, "gifts.giftSubs", { count: gifter.giftSubs }),
  ].filter((part) => part !== false);
}

export function GiftersSection({
  title,
  gifters,
  empty,
  failed,
  platform,
  search,
  onSearch,
}: Props) {
  const t = useT();
  const language = useLanguage();

  let content;
  if (!platform) {
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
    content = <EmptyState>{empty}</EmptyState>;
  } else {
    content = (
      <ol className={styles.gifters} aria-label={title}>
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
            {sentParts(platform, gifter, language).map((part, n) => (
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
        platform && (
          <SearchToggle
            placeholder={t("coinStats.gifters.search")}
            value={search}
            onChange={onSearch}
          />
        )
      }
    >
      {content}
    </Section>
  );
}
