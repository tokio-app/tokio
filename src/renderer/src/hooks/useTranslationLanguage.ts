import { useSetting } from "./useSetting";

/**
 * The language Settings translates chat into, "" while it's off or until the
 * settings say, so nothing about translation shows early.
 */
export const useTranslationLanguage = () =>
  useSetting((s) => s.translation.language, "");
