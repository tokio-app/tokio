import { Platform } from "@/common/types";
import { usePlatforms } from "@/context/platforms";
import { useTranslationLanguage } from "./useTranslationLanguage";

// A variable list as the page offers it: without {translation} while chat
// translation is off (language "") or the profile has no TikTok, the one
// platform whose chat is translated
export const shownVariables = (
  list: readonly string[],
  language: string,
  platforms: readonly Platform[],
): readonly string[] =>
  language === "" || !platforms.includes("tiktok")
    ? list.filter((v) => v !== "translation")
    : list;

/**
 * shownVariables with the language Settings translates into and the page's
 * platforms. Each use asks main for the settings, so a list of many rows
 * asks once, above them.
 */
export function useVariables(list: readonly string[]): readonly string[] {
  return shownVariables(list, useTranslationLanguage(), usePlatforms());
}
