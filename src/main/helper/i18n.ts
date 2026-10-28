import {
  DEFAULT_LANGUAGE,
  MessageKey,
  Params,
  resolveLanguage,
  translate,
} from "@/common/i18n";
import config from "@/config";
import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Listener = (language: string) => void;

// The language main's texts and the windows use, resolved from the setting
let current = DEFAULT_LANGUAGE;
const listeners = new Set<Listener>();

/** The language Tokio shows now, a tag in APP_LANGUAGES. */
export const language = () => current;

/** The key's text in the language Tokio shows now. */
export const t = (key: MessageKey, params?: Params) =>
  translate(current, key, params);

// The OS's languages, or TOKIO_LANG's: e2e and drive-app set it so they don't
// depend on the machine's language
const systemLanguages = () => {
  const forced = process.env.TOKIO_LANG;
  return forced ? [forced] : app.getPreferredSystemLanguages();
};

/**
 * Shows the language the setting (`"system"` or a tag) resolves to, and tells
 * the listeners when it changes.
 */
export function setLanguage(setting: string | undefined) {
  const next = resolveLanguage(setting, systemLanguages());
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener(next);
}

/** Calls the listener on each change of language, until it's removed. */
export function onLanguage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Back to English with no listeners, for each test. */
export function resetLanguage() {
  current = DEFAULT_LANGUAGE;
  listeners.clear();
}

/**
 * The language saved in the store file under the home folder, read straight
 * from it before the store loads, so the splash shows the user's pick.
 * `"system"` when it can't be read.
 */
export function savedLanguage(home: string): string {
  const file = join(
    home,
    config.APP.folderName,
    "settings",
    `${config.DB.name}.json`,
  );
  try {
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const language: unknown = JSON.parse(text)?.settings?.language;
    return typeof language === "string" ? language : "system";
  } catch {
    return "system";
  }
}
