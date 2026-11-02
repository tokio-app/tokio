import { Permissions } from "@/common/schemas";
import { UserData } from "@/common/types";
import { sameHandle } from "./chat";

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
 * permission settings.
 */
export function hasPermission(permissions: Permissions, user: UserData) {
  const { list, level } = permissions;
  if (isBlocked(permissions, user)) return false;
  if (list.enabled && list.white.length > 0) return listed(list.white, user);

  if (permissions.all) return true;

  // [role required, user has it]
  const roles: [boolean, boolean][] = [
    [permissions.followers, Boolean(user.follower)],
    [permissions.moderators, Boolean(user.moderator)],
    [permissions.superfans, Boolean(user.superfan)],
    [level.enabled, (user.fanLevel ?? 0) >= level.value],
  ];
  const required = roles.filter(([needed]) => needed);

  // No role required means everyone passes.
  return required.length === 0 || required.some(([, has]) => has);
}
