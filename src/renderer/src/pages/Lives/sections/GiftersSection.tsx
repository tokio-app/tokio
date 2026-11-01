import { MessageKey } from "@/common/i18n";
import { Gifter } from "@/common/types";
import { Avatar, EmptyState, Section, Spinner } from "@/components";
import { coinsLabel, giftsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import styles from "../lives.module.css";

interface Props {
  title: string;
  // The most coins first, undefined until main sends them
  gifters?: Gifter[];
  // What to say when there are none
  empty?: MessageKey;
  // What to say when main couldn't read them, after its notice
  failed?: MessageKey;
}

export function GiftersSection({
  title,
  gifters,
  empty = "lives.gifters.empty",
  failed,
}: Props) {
  const t = useT();
  const language = useLanguage();

  let content;
  if (failed) {
    content = <EmptyState>{t(failed)}</EmptyState>;
  } else if (!gifters) {
    content = (
      <div className={styles.loading}>
        <Spinner size={20} />
      </div>
    );
  } else if (gifters.length === 0) {
    content = <EmptyState>{t(empty)}</EmptyState>;
  } else {
    content = (
      <ol className={styles.gifters} aria-label={title}>
        {gifters.map((gifter, i) => (
          <li key={gifter.userId} className={styles.gifter}>
            <span className={styles.rank}>{i + 1}</span>
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

  return <Section title={title}>{content}</Section>;
}
