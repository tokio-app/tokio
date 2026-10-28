import { afterEach, describe, expect, it } from "vitest";
import {
  APP_LANGUAGES,
  DEFAULT_LANGUAGE,
  listOf,
  MESSAGES,
  resolveLanguage,
  translate,
} from ".";

describe("APP_LANGUAGES", () => {
  it("lists every locale file, named in its own language", () => {
    expect(APP_LANGUAGES).toEqual([
      { tag: "en", name: "English" },
      { tag: "es-419", name: "Español" },
    ]);
    expect(DEFAULT_LANGUAGE).toBe("en");
  });
});

describe("translate", () => {
  const spanish = { ...MESSAGES["es-419"] };
  afterEach(() => {
    MESSAGES["es-419"] = { ...spanish };
  });

  it("fills in the params it's given, and leaves the other {names}", () => {
    expect(translate("en", "alerts.editor.title", { trigger: "Gift" })).toBe(
      "Gift alert",
    );
    expect(translate("en", "alerts.editor.title")).toBe("{trigger} alert");
    expect(translate("en", "alerts.editor.title", { other: "x" })).toBe(
      "{trigger} alert",
    );
  });

  it("picks the plural form from {count}, formatted for the language", () => {
    expect(translate("en", "gifts.coins", { count: 1 })).toBe("1 coin");
    expect(translate("en", "gifts.coins", { count: 1234 })).toBe("1,234 coins");
    expect(translate("es-419", "gifts.coins", { count: 1 })).toBe("1 moneda");
    // Spanish's "many" falls on #other
    expect(translate("es-419", "gifts.coins", { count: 1_000_000 })).toBe(
      "1,000,000 monedas",
    );
    // A plural text without a count reads as #other
    expect(translate("en", "gifts.coinUnit")).toBe("coins");
  });

  it("falls back to English for a text the language lacks, then to the key", () => {
    delete MESSAGES["es-419"]["gifts.coins#one"];
    expect(translate("es-419", "gifts.coins", { count: 1 })).toBe("1 monedas");
    delete MESSAGES["es-419"]["gifts.coins#other"];
    expect(translate("es-419", "gifts.coins", { count: 1 })).toBe("1 coin");
    expect(translate("fr", "nav.home")).toBe("Home");
    // @ts-expect-error A key en.json doesn't have
    expect(translate("en", "nope")).toBe("nope");
  });
});

describe("resolveLanguage", () => {
  it("uses the saved language when Tokio has it", () => {
    expect(resolveLanguage("es-419", ["en-US"])).toBe("es-419");
    expect(resolveLanguage("en", ["es-MX"])).toBe("en");
  });

  it("follows the system for system, nothing saved, or a language Tokio lacks", () => {
    for (const setting of ["system", undefined, "fr", ""]) {
      expect(resolveLanguage(setting, ["es-PE", "en-US"])).toBe("es-419");
    }
  });

  it("matches a system language exactly or by its base language", () => {
    expect(resolveLanguage("system", ["es-419"])).toBe("es-419");
    expect(resolveLanguage("system", ["ES"])).toBe("es-419");
    expect(resolveLanguage("system", ["fr-FR", "en-GB"])).toBe("en");
    expect(resolveLanguage("system", ["fr-FR", "es"])).toBe("es-419");
  });

  it("reads Linux's locales and skips the ones that name no language", () => {
    expect(resolveLanguage("system", ["es_PE.UTF-8"])).toBe("es-419");
    expect(resolveLanguage("system", ["C", "POSIX", "es_ES@euro"])).toBe("en");
    expect(resolveLanguage("system", ["C.UTF-8", "es_AR"])).toBe("es-419");
  });

  it("falls back to English", () => {
    expect(resolveLanguage("system", [])).toBe("en");
    expect(resolveLanguage("system", ["fr", "ja-JP"])).toBe("en");
  });
});

describe("listOf", () => {
  const names = ["Rose", "Lion", "Galaxy", "Universe"];

  it("joins the items as the language lists them", () => {
    expect(listOf("en", names.slice(0, 2), { type: "or" })).toBe(
      "Rose or Lion",
    );
    expect(listOf("en", names.slice(0, 3), { type: "or" })).toBe(
      "Rose, Lion, or Galaxy",
    );
    expect(listOf("en", names.slice(0, 3))).toBe("Rose, Lion, and Galaxy");
    expect(listOf("es-419", names.slice(0, 3), { type: "or" })).toBe(
      "Rose, Lion o Galaxy",
    );
    expect(listOf("en", ["Rose"])).toBe("Rose");
  });

  it("counts the items past the most it names", () => {
    expect(listOf("en", names, { type: "or", max: 3 })).toBe(
      "Rose, Lion, or 2 more",
    );
    expect(listOf("en", names, { type: "or", max: 4 })).toBe(
      "Rose, Lion, Galaxy, or Universe",
    );
    expect(listOf("es-419", names, { max: 1 })).toBe("Rose y 3 más");
  });
});
