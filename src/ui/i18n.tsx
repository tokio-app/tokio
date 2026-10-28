import {
  DEFAULT_LANGUAGE,
  MessageKey,
  translate,
  Translate,
} from "@/common/i18n";
import { APP_EVENTS_RESPONSE } from "@/common/types";
import {
  createContext,
  Fragment,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// English without a provider, so components render alone in tests
const LanguageContext = createContext(DEFAULT_LANGUAGE);

// The language main loaded the page in, see loadPage
const pageLanguage = () =>
  new URLSearchParams(window.location.search).get("lang") || DEFAULT_LANGUAGE;

/**
 * The language of the window: the one main loaded it in (`?lang`), then each
 * one main sends. The splash has no preload, so it keeps the first.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(pageLanguage);

  useEffect(
    () =>
      window.api?.on(APP_EVENTS_RESPONSE.LANGUAGE, (lang) => {
        if (lang) setLanguage(lang);
      }),
    [],
  );

  // For screen readers, and the browser's own hyphens and quotes
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <LanguageContext value={language}>{children}</LanguageContext>;
}

/** The window's language, a tag in APP_LANGUAGES, for Intl and helpers. */
export const useLanguage = () => useContext(LanguageContext);

/** Translates a key in the window's language: `t("nav.home")`. */
export function useT(): Translate {
  const language = useLanguage();
  return useMemo(
    () => (key, params) => translate(language, key, params),
    [language],
  );
}

/**
 * Options whose labels are keys, as module constants keep them, with their
 * labels translated.
 */
export function useOptions<T extends { label: MessageKey }>(
  options: readonly T[],
): (Omit<T, "label"> & { label: string })[] {
  const t = useT();
  return useMemo(
    () => options.map((option) => ({ ...option, label: t(option.label) })),
    [options, t],
  );
}

type RichValue = ReactNode | ((children: ReactNode) => ReactNode);

/**
 * A translated text with elements inside it, where the translator put them:
 * a function fills `<name>…</name>` with what's between the tags, anything
 * else fills `{name}`. Only the names given match, since some texts show
 * `<script>` or `{username}` as they are.
 */
export function rich(
  message: string,
  values: Record<string, RichValue>,
): ReactNode[] {
  // Names are words, as in the locale files
  const names = Object.keys(values).filter((name) => /^\w+$/.test(name));
  const tags = names.filter((name) => typeof values[name] === "function");
  const slots = names.filter((name) => typeof values[name] !== "function");
  const parts = [
    tags.length > 0 &&
      `<(?<tag>${tags.join("|")})>(?<inner>[\\s\\S]*?)</\\k<tag>>`,
    slots.length > 0 && `\\{(?<slot>${slots.join("|")})\\}`,
  ].filter(Boolean);
  if (parts.length === 0) return [message];
  const pattern = new RegExp(parts.join("|"), "g");

  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    if (match.index > last) nodes.push(message.slice(last, match.index));
    // Only one side of the pattern matched
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const { tag, inner = "", slot = "" } = groups;
    const value = values[tag ?? slot];
    nodes.push(
      <Fragment key={nodes.length}>
        {typeof value === "function" ? value(inner) : value}
      </Fragment>,
    );
    last = match.index + match[0].length;
  }
  if (last < message.length) nodes.push(message.slice(last));
  return nodes;
}
