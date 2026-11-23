import { Platform } from "@/common/types";
import type { IconType } from "react-icons";
import { FaTiktok, FaTwitch, FaYoutube } from "react-icons/fa";
import { SiKick } from "react-icons/si";

// The platforms' logos, Font Awesome's
export const PLATFORM_ICONS: Record<Platform, IconType> = {
  tiktok: FaTiktok,
  twitch: FaTwitch,
  youtube: FaYoutube,
  kick: SiKick,
};
