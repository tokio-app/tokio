import { ActivityItem, ActivityUser } from "@/common/types";
import { Btn, EmptyState, Section } from "@/components";
import { cx } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { useLanguage } from "@/ui/i18n";
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

const DID = {
  follow: "followed you",
  share: "shared the LIVE",
  superfan: "became a Super Fan",
};

// What the viewer did, after their name
function Action({ item }: { item: Exclude<ActivityItem, { type: "join" }> }) {
  const language = useLanguage();
  if (item.type === "chat") {
    return (
      <p className={styles.event_message}>
        {item.text}
        {item.emotes.map((emote, i) => (
          <img key={i} className={styles.inline_img} src={emote} alt="" />
        ))}
      </p>
    );
  }
  if (item.type === "gift") {
    const { name, count } = item.gift;
    return (
      <>
        {count > 1 ? `sent ${name} ×${count}` : `sent ${name}`}
        {item.gift.image && (
          <img className={styles.inline_img} src={item.gift.image} alt="" />
        )}{" "}
        <span className={styles.coins}>
          {coinsLabel(item.gift.coins, language)}
        </span>
      </>
    );
  }
  return DID[item.type];
}

function Event({ item }: { item: ActivityItem }) {
  if (item.type === "join") {
    return (
      <li className={cx(styles.event, styles.event_quiet)}>
        <Avatar user={item.users[0]} />
        {joinedText(item.users, item.count)}
      </li>
    );
  }
  return (
    <li className={styles.event}>
      <Avatar user={item.user} />
      <div className={styles.event_body}>
        <span className={styles.event_name} title={`@${item.user.handle}`}>
          {item.user.name}
        </span>{" "}
        <Action item={item} />
      </div>
    </li>
  );
}

function emptyText(connected: boolean, feedOff: boolean) {
  if (feedOff) {
    return "Every event is hidden. Pick what the feed shows in its settings.";
  }
  if (connected) return "Waiting for the first event…";
  return "Your LIVE's events show up here once you're connected.";
}

export function ActivitySection({
  connected,
  totals,
  activity,
  feedOff,
  onFeedSettings,
}: Props) {
  const language = useLanguage();
  return (
    <Section
      title="Activity"
      actions={
        <Btn variant="icon" title="Feed settings" onClick={onFeedSettings}>
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
              <span className={styles.stat_label}>{label}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.feed}>
        {activity.length === 0 ? (
          <EmptyState>{emptyText(connected, feedOff)}</EmptyState>
        ) : (
          // Not a live region, a busy chat would flood screen readers
          <ol className={styles.feed_list} aria-label="Activity">
            {activity.map((item) => (
              <Event key={item.id} item={item} />
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}
