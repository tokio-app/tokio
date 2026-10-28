import type en from "./locales/en.json";

// Plural forms are `key#one`, `key#other`…, which callers name without the form
type WithoutForm<K> = K extends `${infer Key}#${string}` ? Key : K;

/** A text's key in the locale files, checked against en.json. */
export type MessageKey = WithoutForm<Extract<keyof typeof en, string>>;

/**
 * Values for a text's `{name}`s. `{count}` also picks the plural form and is
 * formatted for the language; pass ports, versions and ids as strings.
 */
export type Params = Record<string, string | number>;

export type Translate = (key: MessageKey, params?: Params) => string;

type Messages = Record<string, string>;

const FILES = import.meta.glob<Messages>("./locales/*.json", {
  eager: true,
  import: "default",
});

/** Every language's texts, by its tag (the file's name). */
export const MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries(FILES).map(([path, messages]) => [
    path.replace(/^.*\/|\.json$/g, ""),
    messages,
  ]),
);

export const DEFAULT_LANGUAGE = "en";

/** The languages Tokio has a file for, each named in its own language. */
export const APP_LANGUAGES = Object.entries(MESSAGES).map(([tag, texts]) => ({
  tag,
  name: texts["language.name"],
}));

// Intl objects are slow to make, and a list of gifts can make many
function cached<T>(make: (key: string) => T) {
  const made = new Map<string, T>();
  return (key: string) => {
    if (!made.has(key)) made.set(key, make(key));
    return made.get(key)!;
  };
}

const pluralRules = cached((language) => new Intl.PluralRules(language));
const numberFormat = cached((language) => new Intl.NumberFormat(language));
const andList = cached((language) => new Intl.ListFormat(language));
const orList = cached(
  (language) => new Intl.ListFormat(language, { type: "disjunction" }),
);

// A text of the language: with a count, its plural form, else `#other`
function lookup(language: string, key: string, count: number | undefined) {
  const texts = MESSAGES[language];
  if (count === undefined) return texts[key] ?? texts[`${key}#other`];
  const form = pluralRules(language).select(count);
  return texts[`${key}#${form}`] ?? texts[`${key}#other`] ?? texts[key];
}

/**
 * The key's text in the language, else in English, with the params filled
 * in. A `{name}` with no param stays as it is: some texts show variables.
 */
export function translate(
  language: string,
  key: MessageKey,
  params?: Params,
): string {
  const lang = Object.hasOwn(MESSAGES, language) ? language : DEFAULT_LANGUAGE;
  const count = typeof params?.count === "number" ? params.count : undefined;
  const text =
    lookup(lang, key, count) ?? lookup(DEFAULT_LANGUAGE, key, count) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.hasOwn(params, name)) return match;
    const value = params[name];
    return name === "count" && typeof value === "number"
      ? numberFormat(lang).format(value)
      : String(value);
  });
}

// "es_PE.UTF-8" (Linux) → "es-PE". Null for C, POSIX and @modifier entries,
// which name no language Tokio could match. String operations only: Intl
// throws on "C".
function systemTag(tag: string): string | null {
  if (tag.includes("@")) return null;
  const clean = tag.split(".")[0].replace(/_/g, "-");
  return clean && clean !== "C" && clean !== "POSIX" ? clean : null;
}

const baseOf = (tag: string) => tag.split("-")[0].toLowerCase();

/**
 * The language to show: the saved one when Tokio has it, else the first of
 * the system's that matches a file exactly or by its base language (es-PE →
 * es-419), else English. `"system"`, undefined and a language Tokio no
 * longer has all follow the system.
 */
export function resolveLanguage(
  setting: string | undefined,
  preferred: readonly string[],
): string {
  if (setting && Object.hasOwn(MESSAGES, setting)) return setting;
  const tags = Object.keys(MESSAGES);
  for (const entry of preferred) {
    const tag = systemTag(entry);
    if (!tag) continue;
    const match =
      tags.find((t) => t.toLowerCase() === tag.toLowerCase()) ??
      tags.find((t) => baseOf(t) === baseOf(tag));
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * The items as the language lists them: "Rose, Lion, and Galaxy", or with
 * `type: "or"` "Rose, Lion, or Galaxy". With more than `max`, the first ones
 * and how many more: "Rose, Lion, or 230 more".
 */
export function listOf(
  language: string,
  items: string[],
  { type = "and", max = Infinity }: { type?: "and" | "or"; max?: number } = {},
): string {
  const lang = Object.hasOwn(MESSAGES, language) ? language : DEFAULT_LANGUAGE;
  let shown = items;
  if (items.length > max) {
    const named = Math.max(max - 1, 1);
    const more = translate(lang, "list.more", { count: items.length - named });
    shown = [...items.slice(0, named), more];
  }
  return (type === "or" ? orList : andList)(lang).format(shown);
}
