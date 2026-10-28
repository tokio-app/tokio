import { MessageKey } from "@/common/i18n";
import { ActivityItem, ActivityUser } from "@/common/types";
import { Btn, EmptyState, Section } from "@/components";
import { cx } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { rich, useLanguage, useT } from "@/ui/i18n";
import { FiSettings } from "react-icons/fi";
import styles from "../home.module.css";
import { joinedText, Stat, statText } from "../helper";

interface Props {
  connected: boolean;
  // Counted since connecting
  totals: Stat[];
  // Newest first
  activity: ActivityItem[];
  // Every kind of event is hidden
  feedOff: boolean;
  onFeedSettings: () => void;
}

// Splits a name into what shows as one character, a flag or emoji included
const characters = new Intl.Segmenter();

function Avatar({ user }: { user: ActivityUser }) {
  if (user.picture) {
    return (
      <img className={styles.avatar} src={user.picture} alt="" loading="lazy" />
    );
  }
  const [initial] = characters.segment(user.name);
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initial?.segment.toUpperCase()}
    </span>
  );
}

const DID: Record<"follow" | "share" | "superfan", MessageKey> = {
  follow: "home.activity.followed",
  share: "home.activity.shared",
  superfan: "home.activity.superfan",
};

// The viewer's name and what they did, in the language's order
function Action({ item }: { item: Exclude<ActivityItem, { type: "join" }> }) {
  const t = useT();
  const language = useLanguage();
  const name = (
    <span className={styles.event_name} title={`@${item.user.handle}`}>
      {item.user.name}
    </span>
  );
  if (item.type === "chat") {
    return (
      <>
        {name}{" "}
        <p className={styles.event_message}>
          {item.text}
          {item.emotes.map((emote, i) => (
            <img key={i} className={styles.inline_img} src={emote} alt="" />
          ))}
        </p>
      </>
    );
  }
  if (item.type === "gift") {
    const { count } = item.gift;
    const sent =
      count > 1
        ? t("home.activity.giftCount", { gift: item.gift.name, count })
        : t("home.activity.gift", { gift: item.gift.name });
    return (
      <>
        {rich(sent, { name })}
        {item.gift.image && (
          <img className={styles.inline_img} src={item.gift.image} alt="" />
        )}{" "}
        <span className={styles.coins}>
          {coinsLabel(item.gift.coins, language)}
        </span>
      </>
    );
  }
  return rich(t(DID[item.type]), { name });
}

function Event({ item }: { item: ActivityItem }) {
  const language = useLanguage();
  if (item.type === "join") {
    return (
      <li className={cx(styles.event, styles.event_quiet)}>
        <Avatar user={item.users[0]} />
        {joinedText(item.users, item.count, language)}
      </li>
    );
  }
  return (
    <li className={styles.event}>
      <Avatar user={item.user} />
      <div className={styles.event_body}>
        <Action item={item} />
      </div>
    </li>
  );
}

function emptyText(connected: boolean, feedOff: boolean): MessageKey {
  if (feedOff) return "home.activity.feedOff";
  if (connected) return "home.activity.waiting";
  return "home.activity.offline";
}

export function ActivitySection({
  connected,
  totals,
  activity,
  feedOff,
  onFeedSettings,
}: Props) {
  const t = useT();
  const language = useLanguage();
  return (
    <Section
      title={t("home.activity.title")}
      actions={
        <Btn
          variant="icon"
          title={t("home.activity.feedSettings")}
          onClick={onFeedSettings}
        >
          <FiSettings size={18} />
        </Btn>
      }
    >
      <div className={styles.totals}>
        {totals.map(({ label, value }) => {
          const { text, title } = statText(value, connected, language);
          return (
            <div key={label} className={styles.total}>
              <span className={styles.total_value} title={title}>
                {text}
              </span>
              <span className={styles.stat_label}>{t(label)}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.feed}>
        {activity.length === 0 ? (
          <EmptyState>{t(emptyText(connected, feedOff))}</EmptyState>
        ) : (
          // Not a live region, a busy chat would flood screen readers
          <ol
            className={styles.feed_list}
            aria-label={t("home.activity.title")}
          >
            {activity.map((item) => (
              <Event key={item.id} item={item} />
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}
