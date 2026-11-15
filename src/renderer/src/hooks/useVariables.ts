import { useTranslationLanguage } from "./useTranslationLanguage";

// A variable list as the page offers it: without {translation} while chat
// translation is off (language ""), since nothing would fill it
export const shownVariables = (
  list: readonly string[],
  language: string,
): readonly string[] =>
  language === "" ? list.filter((v) => v !== "translation") : list;

/**
 * shownVariables with the language Settings translates into. Each use asks
 * main for the settings, so a list of many rows asks once, above them.
 */
export function useVariables(list: readonly string[]): readonly string[] {
  return shownVariables(list, useTranslationLanguage());
}
