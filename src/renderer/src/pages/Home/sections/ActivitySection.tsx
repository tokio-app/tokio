import { MessageKey } from "@/common/i18n";
import { ActivityItem, MusicInfo } from "@/common/types";
import { Avatar, Btn } from "@/components";
import { cx } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { rich, useLanguage, useT } from "@/ui/i18n";
import { memo } from "react";
import { FiSettings } from "react-icons/fi";
import styles from "../home.module.css";
import { joinedText, songParts } from "../helper";

interface Props {
  connected: boolean;
  // Newest first
  activity: ActivityItem[];
  // Every kind of event is hidden
  feedOff: boolean;
  onFeedSettings: () => void;
  // The song playing, while the music player is connected
  song?: MusicInfo;
}

const DID: Record<"follow" | "share" | "superfan", MessageKey> = {
  follow: "home.activity.followed",
  share: "home.activity.shared",
  superfan: "home.activity.superfan",
};

// The viewer's name and what they did, in the language's order
function Action({ item }: { item: Exclude<ActivityItem, { type: "join" }> }) {
  const t = useT();
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
      </>
    );
  }
  return rich(t(DID[item.type]), { name });
}

// Each push brings every item as a new object, so a row renders again only
// when its item changed: main never changes an item, but a join's count
// (its users grow with it)
const sameItem = (
  { item: a }: { item: ActivityItem },
  { item: b }: { item: ActivityItem },
) =>
  a.id === b.id &&
  (a.type !== "join" || (b.type === "join" && a.count === b.count));

const Event = memo(function Event({ item }: { item: ActivityItem }) {
  const language = useLanguage();
  if (item.type === "join") {
    return (
      <li className={cx(styles.event, styles.event_quiet)}>
        <Avatar name={item.users[0].name} picture={item.users[0].picture} />
        {joinedText(item.users, item.count, language)}
      </li>
    );
  }
  return (
    <li className={styles.event}>
      <Avatar name={item.user.name} picture={item.user.picture} />
      <div className={styles.event_body}>
        <Action item={item} />
      </div>
      {/* At the row's end, after the body's trailing space */}
      {item.type === "gift" && (
        <span className={styles.coins}>
          {coinsLabel(item.gift.coins, language)}
        </span>
      )}
    </li>
  );
}, sameItem);

function emptyText(connected: boolean, feedOff: boolean): MessageKey {
  if (feedOff) return "home.activity.feedOff";
  if (connected) return "home.activity.waiting";
  return "home.activity.offline";
}

// The rail: the feed as tall as the window, the song playing at its foot
export function ActivitySection({
  connected,
  activity,
  feedOff,
  onFeedSettings,
  song,
}: Props) {
  const t = useT();
  const { name, artist } = songParts(song?.title ?? "");
  return (
    <section className={styles.rail}>
      <header className={styles.rail_header}>
        <h2 className={styles.rail_title}>{t("home.activity.title")}</h2>
        <Btn
          variant="icon"
          title={t("home.activity.feedSettings")}
          onClick={onFeedSettings}
        >
          <FiSettings size={18} />
        </Btn>
      </header>

      {activity.length === 0 ? (
        <p className={styles.feed_empty}>{t(emptyText(connected, feedOff))}</p>
      ) : (
        // Not a live region, a busy chat would flood screen readers
        <ol className={styles.feed_list} aria-label={t("home.activity.title")}>
          {activity.map((item) => (
            <Event key={item.id} item={item} />
          ))}
        </ol>
      )}

      {song && (
        <footer className={styles.playing}>
          {song.thumbnail && (
            <img className={styles.playing_art} src={song.thumbnail} alt="" />
          )}
          <p className={styles.playing_body}>
            <span className={styles.playing_label}>
              {t("home.playing.title")}
            </span>
            <span className={styles.playing_title} title={name}>
              {name}
            </span>
            {artist && (
              <span className={styles.playing_artist} title={artist}>
                {artist}
              </span>
            )}
          </p>
          <span className={styles.bars} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </footer>
      )}
    </section>
  );
}
