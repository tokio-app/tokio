import { defaultStoreData } from "@/common/util";
import { AppNotification, FEEDBACK_CODES } from "@/common/types";
import { Notifier } from "@/helper/feedback";
import { setLanguage } from "@/helper/i18n";
import { globalShortcut } from "@test/electron";
import { describe, expect, it, vi } from "vitest";
import { applyShortcuts, warnTaken } from "./shortcuts";

const shortcuts = (
  set: Partial<typeof defaultStoreData.settings.shortcuts>,
) => ({
  ...defaultStoreData.settings.shortcuts,
  ...set,
});

describe("applyShortcuts", () => {
  it("registers the ones set, each firing its action", () => {
    const fire = vi.fn();

    const taken = applyShortcuts(
      shortcuts({ skipSong: "F9", pause: "CommandOrControl+Shift+P" }),
      fire,
    );

    expect(taken).toEqual([]);
    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
    globalShortcut.press("CommandOrControl+Shift+P");
    globalShortcut.press("F9");
    expect(fire.mock.calls).toEqual([["pause"], ["skipSong"]]);
  });

  it("drops the ones before", () => {
    const fire = vi.fn();
    applyShortcuts(shortcuts({ skipSong: "F9" }), fire);

    applyShortcuts(shortcuts({ skipSong: "F10" }), fire);

    expect(globalShortcut.press("F9")).toBe(false);
    expect(globalShortcut.press("F10")).toBe(true);
  });

  it("returns the ones another app holds or Electron can't read", () => {
    globalShortcut.take("F9");
    // The first one registered, skipSong's
    globalShortcut.register.mockImplementationOnce(() => {
      throw new Error("conversion failure");
    });

    const taken = applyShortcuts(
      shortcuts({ skipSong: "Nonsense+", stopTts: "F9", replayAlert: "F11" }),
      vi.fn(),
    );

    expect(taken).toEqual(["skipSong", "stopTts"]);
    expect(globalShortcut.isRegistered("F11")).toBe(true);
  });
});

describe("warnTaken", () => {
  const notices = () => {
    const sent: AppNotification[] = [];
    return { notifier: new Notifier((n) => sent.push(n)), sent };
  };

  it("names the actions and where to change them", () => {
    const { notifier, sent } = notices();

    warnTaken(notifier, ["skipSong", "pause"]);

    expect(sent).toEqual([
      expect.objectContaining({
        level: "warning",
        code: FEEDBACK_CODES.SHORTCUT_TAKEN,
        message:
          "Another app already uses the shortcuts for Skip song and Pause everything. Pick different ones in Settings → Shortcuts.",
      }),
    ]);
  });

  it("says it in the app's language", () => {
    const { notifier, sent } = notices();
    setLanguage("es-419");

    warnTaken(notifier, ["stopTts"]);

    expect(sent[0]?.message).toBe(
      "Otra app ya usa el atajo de Detener TTS. Elige otro en Configuración → Atajos de teclado.",
    );
  });

  it("says nothing when none is taken, and once for the same ones", () => {
    const { notifier, sent } = notices();

    warnTaken(notifier, []);
    warnTaken(notifier, ["pause"]);
    warnTaken(notifier, ["pause"]);

    expect(sent).toHaveLength(1);
  });
});
