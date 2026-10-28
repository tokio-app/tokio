import { translate } from "@/common/i18n";
import { VoiceData, VoiceEngine } from "@/common/types";
import type { SelectOption } from "@/components/Elements";

export const voiceKey = (voice: VoiceData) =>
  `${voice.engine}|${voice.lang}|${voice.name}`;

// Language names in each window language, made once
const displayNames = new Map<string, Intl.DisplayNames>();

// Base language of a locale: "en" for "en-US", and for TikTok's "en".
const languageOf = (lang: string) => lang.split(/[-_]/)[0].toLowerCase();

// "English" for "en", "English (United States)" for "en-US", named in the
// window's language. Tags Intl can't read are shown as they are.
function languageName(lang: string, language: string): string {
  let names = displayNames.get(language);
  if (!names) {
    names = new Intl.DisplayNames([language], {
      type: "language",
      languageDisplay: "standard",
    });
    displayNames.set(language, names);
  }
  try {
    return names.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

const ENGLISH_SAMPLE = "Hello! This is how I sound.";

// What voice previews say, in the voice's language: the language's own name
// and today's date, e.g. "español (Argentina). sábado, 18 de octubre de 2026.".
// Languages Intl doesn't know get the English line.
export function voiceSample(lang: string): string {
  try {
    if (Intl.DisplayNames.supportedLocalesOf(lang).length === 0) {
      return ENGLISH_SAMPLE;
    }
    // Variants are left out, they're named in Latin letters (zh-CN-liaoning).
    const { language, script, region } = new Intl.Locale(lang);
    const tag = [language, script, region].filter(Boolean).join("-");
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(tag);
    const date = new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(
      new Date(),
    );
    return `${name}. ${date}.`;
  } catch {
    return ENGLISH_SAMPLE;
  }
}

// Locale and engine of a voice, e.g. "English (United States) · Edge". The
// engine is left out until it's known.
export function voiceDetails(
  voice: VoiceData,
  engines: VoiceEngine[],
  language: string,
) {
  const locale = languageName(voice.lang, language);
  const engine = engines.find((e) => e.id === voice.engine);
  return engine ? `${locale} · ${engine.label}` : locale;
}

export type VoiceEntry = {
  voice: VoiceData;
  key: string;
  // Base language, e.g. "en"
  language: string;
  details: string;
  // Lowercase name, locale and engine, which the search looks in
  text: string;
};

// Sorted by locale and engine, then name, so a language's voices from every
// engine sit together.
export function voiceEntries(
  voices: VoiceData[],
  engines: VoiceEngine[],
  language: string,
): VoiceEntry[] {
  return voices
    .map((voice) => {
      const details = voiceDetails(voice, engines, language);
      return {
        voice,
        key: voiceKey(voice),
        language: languageOf(voice.lang),
        details,
        text: `${voice.name} ${voice.lang} ${details}`.toLowerCase(),
      };
    })
    .sort(
      (a, b) =>
        a.details.localeCompare(b.details, language) ||
        a.voice.name.localeCompare(b.voice.name, language),
    );
}

// An empty engine or language means any.
export type VoiceFilter = { search: string; engine: string; language: string };

export function filterVoices(
  entries: VoiceEntry[],
  { search, engine, language }: VoiceFilter,
) {
  const needle = search.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (engine === "" || entry.voice.engine === engine) &&
      (language === "" || entry.language === language) &&
      entry.text.includes(needle),
  );
}

// The engines that have voices
export function engineOptions(
  entries: VoiceEntry[],
  engines: VoiceEngine[],
  language: string,
): SelectOption<string>[] {
  const used = new Set(entries.map((e) => e.voice.engine));
  return [
    {
      value: "",
      label: translate(language, "components.voicePicker.allEngines"),
    },
    ...engines
      .filter((e) => used.has(e.id))
      .map((e) => ({ value: e.id, label: e.label })),
  ];
}

// Base languages by name, e.g. "English" for en-US, en-GB and en.
export function languageOptions(
  entries: VoiceEntry[],
  language: string,
): SelectOption<string>[] {
  const languages = new Set(entries.map((e) => e.language));
  const options = [...languages]
    .map((base) => ({ value: base, label: languageName(base, language) }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
  return [
    {
      value: "",
      label: translate(language, "components.voicePicker.allLanguages"),
    },
    ...options,
  ];
}
