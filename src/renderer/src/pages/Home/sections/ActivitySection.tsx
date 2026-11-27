import { MessageKey } from "@/common/i18n";
import {
  ActivityItem,
  ActivityUser,
  ChatTranslation,
  MusicInfo,
} from "@/common/types";
import { GIFT_CURRENCY, PLATFORM_LABELS, platformOf } from "@/common/util";
import { languageName } from "@/helper/voices";
import { Avatar, Btn } from "@/components";
import { cx, PLATFORM_ICONS } from "@/helper";
import { amountLabel } from "@/helper/gifts";
import { rich, useLanguage, useT } from "@/ui/i18n";
import { memo } from "react";
import { FiSettings } from "react-icons/fi";
import { MdTranslate } from "react-icons/md";
import styles from "../home.module.css";
import { joinedText, songParts } from "../helper";

interface Props {
  connected: boolean;
  // The profile uses two or more platforms, so each row shows its own
  showPlatform?: boolean;
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

type ChatItem = Extract<ActivityItem, { type: "chat" }>;

// The viewer's platform, by their name
function PlatformMark({ user }: { user: ActivityUser }) {
  const platform = platformOf(user);
  const Icon = PLATFORM_ICONS[platform];
  return (
    <Icon
      className={styles.event_platform}
      size={14}
      role="img"
      aria-label={PLATFORM_LABELS[platform]}
    />
  );
}

// The viewer's name, after their platform's logo when the feed shows it
function Name({ user, mark }: { user: ActivityUser; mark?: boolean }) {
  return (
    <span className={styles.event_name} title={`@${user.handle}`}>
      {mark && <PlatformMark user={user} />}
      {user.name}
    </span>
  );
}

// What a message got translated into, under it: the glyph marks it, and a
// screen reader hears where it came from first
function Translation({ translation }: { translation: ChatTranslation }) {
  const t = useT();
  const language = useLanguage();
  return (
    <p className={styles.event_translation}>
      <MdTranslate
        className={styles.event_glyph}
        size={14}
        aria-hidden="true"
      />
      <span className={styles.sr_only}>
        {t("home.activity.translatedFrom", {
          language: languageName(translation.from, language),
        })}
      </span>
      <span lang={translation.to}>{translation.text}</span>
    </p>
  );
}

// A chat row. Settings' translation tester draws it too, so it shows the
// streamer what the feed will.
export function ChatRow({
  user,
  text,
  emotes,
  translation,
  mark,
}: Pick<ChatItem, "user" | "text" | "emotes" | "translation"> & {
  mark?: boolean;
}) {
  return (
    <li className={styles.event}>
      <Avatar name={user.name} picture={user.picture} />
      <div className={styles.event_body}>
        <Name user={user} mark={mark} />{" "}
        <p className={styles.event_message}>
          {text}
          {emotes.map((emote, i) => (
            <img key={i} className={styles.inline_img} src={emote} alt="" />
          ))}
        </p>
        {translation && <Translation translation={translation} />}
      </div>
    </li>
  );
}

// The viewer's name and what they did, in the language's order
function Action({
  item,
  mark,
}: {
  item: Exclude<ActivityItem, { type: "join" | "chat" }>;
  mark?: boolean;
}) {
  const t = useT();
  const name = <Name user={item.user} mark={mark} />;
  switch (item.type) {
    case "gift": {
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
    case "giftsub":
      return rich(t("home.activity.giftsub", { count: item.count }), { name });
    case "raid":
      return rich(t("home.activity.raid", { count: item.viewers }), { name });
    case "superchat":
      if (item.sticker) {
        return (
          <>
            {rich(t("home.activity.superSticker", { amount: item.amount }), {
              name,
            })}
            <img className={styles.inline_img} src={item.sticker} alt="" />{" "}
          </>
        );
      }
      return (
        <>
          {rich(t("home.activity.superchat", { amount: item.amount }), {
            name,
          })}
          {item.text && <p className={styles.event_message}>{item.text}</p>}
        </>
      );
    case "sub":
    case "cheer":
    case "kicks":
    case "redeem":
      return (
        <>
          {rich(
            item.type === "sub"
              ? item.months > 1
                ? t("home.activity.resub", { count: item.months })
                : t("home.activity.sub")
              : item.type === "cheer"
                ? t("home.activity.cheer", { count: item.bits })
                : item.type === "kicks"
                  ? t("home.activity.kicks", { count: item.kicks })
                  : t("home.activity.redeem", { reward: item.reward }),
            { name },
          )}
          {/* What the viewer wrote, as a chat's message */}
          {item.text && <p className={styles.event_message}>{item.text}</p>}
        </>
      );
    default:
      return rich(t(DID[item.type]), { name });
  }
}

// Each push brings every item as a new object, so a row renders again only
// when its item changed: main never changes an item, but a join's count
// (its users grow with it)
const sameItem = (
  { item: a, mark: markA }: { item: ActivityItem; mark?: boolean },
  { item: b, mark: markB }: { item: ActivityItem; mark?: boolean },
) =>
  a.id === b.id &&
  markA === markB &&
  (a.type !== "join" || (b.type === "join" && a.count === b.count));

const Event = memo(function Event({
  item,
  mark,
}: {
  item: ActivityItem;
  mark?: boolean;
}) {
  const language = useLanguage();
  if (item.type === "join") {
    return (
      <li className={cx(styles.event, styles.event_quiet)}>
        <Avatar name={item.users[0].name} picture={item.users[0].picture} />
        {joinedText(item.users, item.count, language)}
      </li>
    );
  }
  if (item.type === "chat") return <ChatRow {...item} mark={mark} />;
  // A gift's price is in its sender's platform's currency
  const currency = GIFT_CURRENCY[platformOf(item.user)];
  return (
    <li className={styles.event}>
      <Avatar name={item.user.name} picture={item.user.picture} />
      <div className={styles.event_body}>
        <Action item={item} mark={mark} />
      </div>
      {/* At the row's end, after the body's trailing space. A gift without
          a known price, like a regional one on YouTube, shows none. */}
      {item.type === "gift" && item.gift.coins > 0 && currency && (
        <span className={styles.coins}>
          {amountLabel(item.gift.coins, currency, language)}
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
  showPlatform,
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
            <Event key={item.id} item={item} mark={showPlatform} />
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
