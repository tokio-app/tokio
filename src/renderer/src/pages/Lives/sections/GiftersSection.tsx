import { Gifter, RankedGifter } from "@/common/types";
import {
  Avatar,
  EmptyState,
  SearchToggle,
  Section,
  Spinner,
} from "@/components";
import { coinsLabel, giftsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import styles from "../lives.module.css";

export interface GiftersList {
  // The most coins first, undefined until main sends them. A search's come
  // with their place among all of them.
  gifters?: (Gifter | RankedGifter)[];
  // What to say when there are none
  empty: string;
  // What to say when main couldn't send them, after its notice
  failed?: string;
}

interface Props extends GiftersList {
  title: string;
  search: string;
  onSearch: (search: string) => void;
}

export function GiftersSection({
  title,
  gifters,
  empty,
  failed,
  search,
  onSearch,
}: Props) {
  const t = useT();
  const language = useLanguage();

  let content;
  if (failed) {
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
            <span className={styles.amount}>
              {coinsLabel(gifter.coins, language)}
            </span>
            <span className={styles.amount}>
              {giftsLabel(gifter.gifts, language)}
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <Section
      title={title}
      actions={
        <SearchToggle
          placeholder={t("lives.gifters.search")}
          value={search}
          onChange={onSearch}
        />
      }
    >
      {content}
    </Section>
  );
}
