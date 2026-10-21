import { Permissions } from "@/common/schemas";
import { UserData } from "@/common/types";
import { sameHandle } from "./chat";

/**
 * Whether a chat user may use a feature (TTS, music requests) under its
 * permission settings.
 */
export function hasPermission(permissions: Permissions, user: UserData) {
  if (permissions.all) return true;

  const { list, level } = permissions;
  if (list.enabled) {
    const listed = (handles: string[]) =>
      handles.some((handle) => sameHandle(handle, user.handle));
    const whitelisted = list.white.length === 0 || listed(list.white);
    return whitelisted && !listed(list.black);
  }

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
