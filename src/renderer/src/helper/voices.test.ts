import { engine, voice } from "@test/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  engineOptions,
  filterVoices,
  languageOptions,
  voiceDetails,
  voiceEntries,
  voiceKey,
  voiceSample,
} from "./voices";

const ENGINES = [
  engine("edge", "Edge"),
  engine("windows", "Windows"),
  engine("tiktok", "TikTok", "Session ID"),
];

const VOICES = [
  voice("Zed", "es-MX"),
  voice("Ana", "es-MX", "windows"),
  voice("Bob", "en-US"),
  voice("Amy", "en-US"),
];

describe("voiceKey", () => {
  it("names the voice by engine, language and name", () => {
    expect(voiceKey(voice("Aria", "en-US", "edge"))).toBe("edge|en-US|Aria");
  });
});

describe("voiceDetails", () => {
  it("shows the locale and the engine", () => {
    expect(voiceDetails(voice("Aria", "en-US"), ENGINES)).toBe(
      "English (United States) · Edge",
    );
  });

  it("leaves the engine out until it's known", () => {
    expect(voiceDetails(voice("Aria", "en-US"), [])).toBe(
      "English (United States)",
    );
    expect(voiceDetails(voice("Aria", "en", "gone"), ENGINES)).toBe("English");
  });

  it("shows a tag Intl can't read as it is", () => {
    expect(voiceDetails(voice("Odd", "not a tag"), [])).toBe("not a tag");
  });
});

describe("voiceEntries", () => {
  it("sorts by locale and engine, then by name", () => {
    const names = voiceEntries(VOICES, ENGINES).map((e) => e.voice.name);
    expect(names).toEqual(["Amy", "Bob", "Zed", "Ana"]);
  });

  it("keeps the base language and the text the search looks in", () => {
    const [entry] = voiceEntries([voice("Zed", "es-MX")], ENGINES);
    expect(entry).toEqual({
      voice: voice("Zed", "es-MX"),
      key: "edge|es-MX|Zed",
      language: "es",
      details: "Spanish (Mexico) · Edge",
      text: "zed es-mx spanish (mexico) · edge",
    });
  });
});

describe("filterVoices", () => {
  const entries = voiceEntries(VOICES, ENGINES);
  const names = (filter: Partial<Parameters<typeof filterVoices>[1]>) =>
    filterVoices(entries, {
      search: "",
      engine: "",
      language: "",
      ...filter,
    }).map((e) => e.voice.name);

  it("keeps every voice without a filter", () => {
    expect(names({})).toHaveLength(4);
  });

  it("searches names, locales and engines, ignoring case and spaces", () => {
    expect(names({ search: "  AMY " })).toEqual(["Amy"]);
    expect(names({ search: "mexico" })).toEqual(["Zed", "Ana"]);
    expect(names({ search: "windows" })).toEqual(["Ana"]);
    expect(names({ search: "nobody" })).toEqual([]);
  });

  it("narrows by engine and base language", () => {
    expect(names({ engine: "windows" })).toEqual(["Ana"]);
    expect(names({ language: "en" })).toEqual(["Amy", "Bob"]);
    expect(names({ language: "es", engine: "edge" })).toEqual(["Zed"]);
  });
});

describe("engineOptions", () => {
  it("lists only the engines that have voices", () => {
    expect(engineOptions(voiceEntries(VOICES, ENGINES), ENGINES)).toEqual([
      { value: "", label: "All engines" },
      { value: "edge", label: "Edge" },
      { value: "windows", label: "Windows" },
    ]);
  });
});

describe("languageOptions", () => {
  it("lists each base language once, by name", () => {
    const entries = voiceEntries(
      [...VOICES, voice("Gus", "en-GB"), voice("Ola", "en")],
      ENGINES,
    );
    expect(languageOptions(entries)).toEqual([
      { value: "", label: "All languages" },
      { value: "en", label: "English" },
      { value: "es", label: "Spanish" },
    ]);
  });
});

describe("voiceSample", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the language's own name and today's date in it", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 18, 12) });

    const sample = voiceSample("es-AR");
    expect(sample).toMatch(
      /^español \(Argentina\)\. .+18 de octubre de 2026\.$/,
    );
  });

  it("falls back to English for languages Intl doesn't know", () => {
    expect(voiceSample("zz")).toBe("Hello! This is how I sound.");
    expect(voiceSample("not a tag")).toBe("Hello! This is how I sound.");
  });
});
