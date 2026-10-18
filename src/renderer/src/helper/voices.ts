import { VoiceData, VoiceEngine } from "@/common/types";
import type { SelectOption } from "@/components/Elements";

// What voice previews say
export const VOICE_SAMPLE = "Hello! This is how I sound.";

export const voiceKey = (voice: VoiceData) =>
  `${voice.engine}|${voice.lang}|${voice.name}`;

const displayNames = new Intl.DisplayNames(["en"], {
  type: "language",
  languageDisplay: "standard",
});

// Base language of a locale: "en" for "en-US", and for TikTok's "en".
const languageOf = (lang: string) => lang.split(/[-_]/)[0].toLowerCase();

// "English" for "en", "English (United States)" for "en-US". Tags Intl can't
// read are shown as they are.
function languageName(lang: string): string {
  try {
    return displayNames.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

// Locale and engine of a voice, e.g. "English (United States) · Edge". The
// engine is left out until it's known.
export function voiceDetails(voice: VoiceData, engines: VoiceEngine[]) {
  const locale = languageName(voice.lang);
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
): VoiceEntry[] {
  return voices
    .map((voice) => {
      const details = voiceDetails(voice, engines);
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
        a.details.localeCompare(b.details) ||
        a.voice.name.localeCompare(b.voice.name),
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
): SelectOption<string>[] {
  const used = new Set(entries.map((e) => e.voice.engine));
  return [
    { value: "", label: "All engines" },
    ...engines
      .filter((e) => used.has(e.id))
      .map((e) => ({ value: e.id, label: e.label })),
  ];
}

// Base languages by name, e.g. "English" for en-US, en-GB and en.
export function languageOptions(entries: VoiceEntry[]): SelectOption<string>[] {
  const languages = new Set(entries.map((e) => e.language));
  const options = [...languages]
    .map((language) => ({ value: language, label: languageName(language) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: "All languages" }, ...options];
}
