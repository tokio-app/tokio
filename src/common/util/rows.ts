import { listOf, translate, type MessageKey } from "../i18n";
import {
  VIEWER_ROLES,
  type Trigger,
  type ViewerRole,
} from "../schemas/profile";
import {
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
  type AlertTrigger,
  type Platform,
} from "../types/connector";
import { rowPlatforms } from "./platforms";

// What a trigger row offers, following the platforms it covers
// (rowPlatforms): its variables and its viewer roles. Apart from alerts.ts,
// which the schemas import.

type Row = Pick<Trigger, "type" | "platform">;

// The roles each platform's events say. TikTok's chat, emotes and gifts say
// who follows, moderates or is a Super Fan. The others' chat says
// moderators and subscribers or members, from their badges, and Twitch's
// and Kick's VIPs, but never who follows; their gifts say none.
const TIKTOK_ROLES: readonly ViewerRole[] = [
  "follower",
  "moderator",
  "superfan",
];
const BADGES: readonly ViewerRole[] = ["moderator", "superfan"];
const WITH_VIPS: readonly ViewerRole[] = [...BADGES, "vip"];
const chatSays = (roles: readonly ViewerRole[]) => ({
  [TOKIO_EVENTS.CHAT]: roles,
  [EMOTE_TRIGGER]: roles,
});
const PLATFORM_ROLES: Record<
  Platform,
  Partial<Record<AlertTrigger, readonly ViewerRole[]>>
> = {
  tiktok: { ...chatSays(TIKTOK_ROLES), [TOKIO_EVENTS.GIFT]: TIKTOK_ROLES },
  twitch: chatSays(WITH_VIPS),
  youtube: chatSays(BADGES),
  kick: chatSays(WITH_VIPS),
};

// The platforms of a row whose events say the role
const sayingRole = (
  role: ViewerRole,
  row: Row,
  profilePlatforms: readonly Platform[],
) =>
  rowPlatforms(row, profilePlatforms).filter((p) =>
    PLATFORM_ROLES[p][row.type]?.includes(role),
  );

/** The roles a row can narrow to: the ones its platforms' events say. */
export const rowRoles = (
  row: Row,
  profilePlatforms: readonly Platform[],
): ViewerRole[] =>
  VIEWER_ROLES.filter(
    (role) => sayingRole(role, row, profilePlatforms).length > 0,
  );

const ROLE_KEYS = {
  follower: "roles.follower",
  moderator: "roles.moderator",
  vip: "roles.vips",
} as const;

// What each platform calls the people its Super Fan role means
const SUPERFAN_KEYS: Record<Platform, MessageKey> = {
  tiktok: "roles.superfan",
  twitch: "roles.subscribers",
  youtube: "roles.members",
  kick: "roles.subscribers",
};

/**
 * A role as the row's platforms call it. TikTok's Super Fans are Twitch's
 * and Kick's subscribers and YouTube's members, so a row for several names
 * each: "Super Fans, subscribers, and members" (the user's call).
 */
export function roleName(
  role: ViewerRole,
  row: Row,
  profilePlatforms: readonly Platform[],
  language: string,
): string {
  if (role !== "superfan") return translate(language, ROLE_KEYS[role]);
  const platforms = sayingRole(role, row, profilePlatforms);
  const keys = new Set(
    (platforms.length > 0 ? platforms : ["tiktok" as const]).map(
      (p) => SUPERFAN_KEYS[p],
    ),
  );
  // Super Fans is a name, first when TikTok's among them; the rest are words
  const names = [...keys].map((key, i) => {
    const name = translate(language, key);
    return i === 0 ? name : name.toLocaleLowerCase(language);
  });
  return listOf(language, names);
}

// Variables a platform's event never fills, so its rows don't offer them.
// YouTube's gifts come one at a time, so {count} is always 1, and Kick's
// subs carry no message.
const UNFILLED: Partial<
  Record<Platform, Partial<Record<AlertTrigger, readonly string[]>>>
> = {
  youtube: { [TOKIO_EVENTS.GIFT]: ["count"] },
  kick: { [TOKIO_EVENTS.SUBSCRIBE]: ["comment"] },
};

/**
 * The variables of `list` a row's message can say: the ones any of its
 * platforms fills (rowPlatforms). All of them on a row no platform sends,
 * like Music change.
 */
export function rowVariables(
  list: readonly string[],
  row: Row,
  profilePlatforms: readonly Platform[],
): string[] {
  const platforms = rowPlatforms(row, profilePlatforms);
  if (platforms.length === 0) return [...list];
  return list.filter((name) =>
    platforms.some((p) => !UNFILLED[p]?.[row.type]?.includes(name)),
  );
}

/**
 * Whether a gift row's gifts come in streaks, so it picks when to play:
 * TikTok's do, YouTube's come one at a time. TikTok's catalog,
 * the one to pick from, goes with it.
 */
export const rowStreaks = (
  row: Row,
  profilePlatforms: readonly Platform[],
): boolean => rowPlatforms(row, profilePlatforms).includes("tiktok");
