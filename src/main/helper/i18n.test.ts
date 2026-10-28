import { app } from "@test/electron";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { language, onLanguage, savedLanguage, setLanguage, t } from "./i18n";

describe("setLanguage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts in English", () => {
    expect(language()).toBe("en");
    expect(t("nav.settings")).toBe("Settings");
  });

  it("shows the saved language, or the system's for system", () => {
    setLanguage("es-419");
    expect(language()).toBe("es-419");
    expect(t("nav.settings")).toBe("Configuración");

    app.getPreferredSystemLanguages.mockReturnValue(["fr-FR", "es-MX"]);
    setLanguage("system");
    expect(language()).toBe("es-419");

    app.getPreferredSystemLanguages.mockReturnValue(["fr-FR"]);
    setLanguage("system");
    expect(language()).toBe("en");
  });

  it("takes the system's language from TOKIO_LANG when it's set", () => {
    app.getPreferredSystemLanguages.mockReturnValue(["en-US"]);
    vi.stubEnv("TOKIO_LANG", "es-419");
    setLanguage("system");
    expect(language()).toBe("es-419");
    // A saved language still wins
    setLanguage("en");
    expect(language()).toBe("en");
  });

  it("tells the listeners each change, until they're removed", () => {
    const listener = vi.fn();
    const off = onLanguage(listener);

    setLanguage("es-419");
    setLanguage("es-419");
    setLanguage("en");
    off();
    setLanguage("es-419");

    expect(listener.mock.calls).toEqual([["es-419"], ["en"]]);
  });
});

describe("savedLanguage", () => {
  let home: string;
  const settings = () => join(home, ".tokio", "settings");

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "tokio-test-"));
    await mkdir(settings(), { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const save = (text: string) =>
    writeFile(join(settings(), "tokio.json"), text);

  it("reads the language from the store file", async () => {
    await save(JSON.stringify({ settings: { language: "es-419" } }));
    expect(savedLanguage(home)).toBe("es-419");
  });

  it("reads a file saved with a BOM", async () => {
    await save(
      String.fromCharCode(0xfeff) +
        JSON.stringify({ settings: { language: "es-419" } }),
    );
    expect(savedLanguage(home)).toBe("es-419");
  });

  it("follows the system when there's no language to read", async () => {
    expect(savedLanguage(home)).toBe("system");
    await save("{ not json");
    expect(savedLanguage(home)).toBe("system");
    await save(JSON.stringify({ settings: { language: 3 } }));
    expect(savedLanguage(home)).toBe("system");
    await save("null");
    expect(savedLanguage(home)).toBe("system");
  });
});
