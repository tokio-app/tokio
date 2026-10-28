import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The files as written: JSON.parse would hide a key written twice
const FOLDER = join(__dirname, "locales");
const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({
    tag: name.slice(0, -".json".length),
    text: readFileSync(join(FOLDER, name), "utf8"),
  }));

const keysOf = (text: string) =>
  [...text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map(([, key]) => key);

// Each text's key without its plural form, with the forms it has
function entries(text: string) {
  const texts: Record<string, string> = JSON.parse(text);
  const byKey = new Map<string, { forms: string[]; texts: string[] }>();
  for (const [key, value] of Object.entries(texts)) {
    const [base, form] = key.split("#");
    const entry = byKey.get(base) ?? { forms: [], texts: [] };
    if (form) entry.forms.push(form);
    entry.texts.push(value);
    byKey.set(base, entry);
  }
  return byKey;
}

const names = (texts: string[], pattern: RegExp) =>
  [...new Set(texts.flatMap((t) => [...t.matchAll(pattern)].map((m) => m[1])))]
    .sort()
    .join(",");
const params = (texts: string[]) => names(texts, /\{(\w+)\}/g);
const tags = (texts: string[]) => names(texts, /<\/?(\w+)>/g);

const english = entries(files.find((f) => f.tag === "en")!.text);

describe.each(files)("$tag.json", ({ tag, text }) => {
  it("is named by a canonical language tag, in UTF-8 without a BOM", () => {
    expect(Intl.getCanonicalLocales(tag)).toEqual([tag]);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("has each key once, and only texts", () => {
    const keys = keysOf(text);
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
    const texts: Record<string, unknown> = JSON.parse(text);
    expect(keys).toHaveLength(Object.keys(texts).length);
    for (const value of Object.values(texts))
      expect(typeof value).toBe("string");
  });

  it("names its language", () => {
    expect(JSON.parse(text)["language.name"]?.trim()).toBeTruthy();
  });

  it("has English's keys, params and tags", () => {
    const own = entries(text);
    expect([...own.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, { forms, texts }] of own) {
      const en = english.get(key)!;
      expect(forms.length > 0, `${key} is plural in English`).toBe(
        en.forms.length > 0,
      );
      expect(params(texts), `${key}'s {params}`).toBe(params(en.texts));
      expect(tags(texts), `${key}'s <tags>`).toBe(tags(en.texts));
    }
  });

  it("has #other and only the plural forms the language uses", () => {
    const categories: string[] = new Intl.PluralRules(tag).resolvedOptions()
      .pluralCategories;
    for (const [key, { forms }] of entries(text)) {
      if (forms.length === 0) continue;
      expect(forms, key).toContain("other");
      for (const form of forms)
        expect(categories, `${key}#${form}`).toContain(form);
    }
  });
});
