import { Permissions } from "@/common/schemas";
import { UserData } from "@/common/types";
import { defaultPlatformPermissions, platformOf } from "@/common/util";
import { sameHandle } from "./chat";

// [role required, user has it]: no role required means everyone passes
const passes = (roles: [boolean, boolean][]) => {
  const required = roles.filter(([needed]) => needed);
  return required.length === 0 || required.some(([, has]) => has);
};

const listed = (handles: string[], user: UserData) =>
  handles.some((handle) => sameHandle(handle, user.handle));

/**
 * Whether the viewer's handle is on the block list, while the lists are on.
 */
export function isBlocked(permissions: Permissions, user: UserData | null) {
  const { list } = permissions;
  return Boolean(user && list.enabled && listed(list.black, user));
}

/**
 * Whether a chat user may use a feature (TTS, music requests) under its
 * permission settings: the lists on every platform, then their platform's
 * rules. The rules are TikTok's, the others' in platforms.
 */
export function hasPermission(permissions: Permissions, user: UserData) {
  const { list, level } = permissions;
  if (isBlocked(permissions, user)) return false;
  if (list.enabled && list.white.length > 0) return listed(list.white, user);

  const platform = platformOf(user);
  if (platform !== "tiktok") {
    const rules = permissions.platforms[platform] ?? defaultPlatformPermissions;
    if (rules.all) return true;
    return passes([
      [rules.moderators, Boolean(user.moderator)],
      [rules.superfans, Boolean(user.superfan)],
      [rules.vips, Boolean(user.vip)],
    ]);
  }

  if (permissions.all) return true;
  return passes([
    [permissions.followers, Boolean(user.follower)],
    [permissions.moderators, Boolean(user.moderator)],
    [permissions.superfans, Boolean(user.superfan)],
    [level.enabled, (user.fanLevel ?? 0) >= level.value],
  ]);
}
