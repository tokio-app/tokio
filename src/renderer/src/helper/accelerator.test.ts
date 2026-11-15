import { describe, expect, it } from "vitest";
import { acceleratorKeys, KeyPress, toAccelerator } from "./accelerator";

const press = (key: string, code: string, mods: Partial<KeyPress> = {}) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  altGraph: false,
  ...mods,
});
const ctrlShift = { ctrlKey: true, shiftKey: true };

describe("toAccelerator", () => {
  it("waits while only modifiers are held", () => {
    for (const key of ["Control", "Alt", "Shift", "Meta", "AltGraph"]) {
      expect(toAccelerator(press(key, "", ctrlShift), "windows")).toBeNull();
    }
  });

  it("names the letter the key types on the layout, not its place on a US keyboard", () => {
    // German: the key in US Y's place types Z
    const german = new Map([["KeyY", "z"]]);
    expect(
      toAccelerator(press("Z", "KeyY", ctrlShift), "windows", german),
    ).toEqual({ accelerator: "Ctrl+Shift+Z" });
  });

  it("falls back to e.key when there's no layout, if it's one Latin letter", () => {
    expect(toAccelerator(press("s", "KeyS", ctrlShift), "linux")).toEqual({
      accelerator: "Ctrl+Shift+S",
    });
    expect(toAccelerator(press("ñ", "Semicolon", ctrlShift), "linux")).toEqual({
      refused: "key",
    });
    // The layout's ñ isn't a key Electron knows
    const spanish = new Map([["Semicolon", "ñ"]]);
    expect(
      toAccelerator(press("ñ", "Semicolon", ctrlShift), "linux", spanish),
    ).toEqual({ refused: "key" });
  });

  it("reads digits from the number row's place, whatever Shift types", () => {
    expect(toAccelerator(press("!", "Digit1", ctrlShift), "windows")).toEqual({
      accelerator: "Ctrl+Shift+1",
    });
    // AZERTY types & there
    expect(toAccelerator(press("&", "Digit1", ctrlShift), "windows")).toEqual({
      accelerator: "Ctrl+Shift+1",
    });
  });

  it("lets F-keys, the numpad and media keys stand alone", () => {
    const alone: [string, string, string][] = [
      ["F1", "F1", "F1"],
      ["F24", "F24", "F24"],
      ["5", "Numpad5", "num5"],
      ["+", "NumpadAdd", "numadd"],
      ["-", "NumpadSubtract", "numsub"],
      ["*", "NumpadMultiply", "nummult"],
      ["/", "NumpadDivide", "numdiv"],
      [".", "NumpadDecimal", "numdec"],
      ["MediaTrackNext", "MediaTrackNext", "MediaNextTrack"],
      ["MediaTrackPrevious", "MediaTrackPrevious", "MediaPreviousTrack"],
      ["MediaPlayPause", "MediaPlayPause", "MediaPlayPause"],
      ["MediaStop", "MediaStop", "MediaStop"],
      ["AudioVolumeUp", "AudioVolumeUp", "VolumeUp"],
      ["AudioVolumeDown", "AudioVolumeDown", "VolumeDown"],
      ["AudioVolumeMute", "AudioVolumeMute", "VolumeMute"],
    ];
    for (const [key, code, accelerator] of alone) {
      expect(toAccelerator(press(key, code), "windows")).toEqual({
        accelerator,
      });
    }
    expect(toAccelerator(press("F5", "F5", { altKey: true }), "linux")).toEqual(
      { accelerator: "Alt+F5" },
    );
  });

  it("reads a numpad key with Num Lock off as the key it acts as", () => {
    expect(toAccelerator(press("End", "Numpad1"), "windows")).toEqual({
      refused: "modifiers",
    });
    expect(
      toAccelerator(press("End", "Numpad1", ctrlShift), "windows"),
    ).toEqual({ accelerator: "Ctrl+Shift+End" });
  });

  it("names the arrows, Space and the navigation keys", () => {
    const named: [string, string, string][] = [
      ["ArrowUp", "ArrowUp", "Up"],
      ["ArrowDown", "ArrowDown", "Down"],
      ["ArrowLeft", "ArrowLeft", "Left"],
      ["ArrowRight", "ArrowRight", "Right"],
      [" ", "Space", "Space"],
      ["Home", "Home", "Home"],
      ["End", "End", "End"],
      ["PageUp", "PageUp", "PageUp"],
      ["PageDown", "PageDown", "PageDown"],
      ["Insert", "Insert", "Insert"],
      ["Delete", "Delete", "Delete"],
    ];
    for (const [key, code, name] of named) {
      expect(toAccelerator(press(key, code, ctrlShift), "windows")).toEqual({
        accelerator: `Ctrl+Shift+${name}`,
      });
    }
  });

  it("refuses keys a shortcut can't use", () => {
    for (const [key, code] of [
      ["Tab", "Tab"],
      ["Enter", "Enter"],
      [",", "Comma"],
      ["Process", "KeyA"],
      ["Dead", "BracketLeft"],
      ["F25", "F25"],
    ]) {
      expect(toAccelerator(press(key, code, ctrlShift), "windows")).toEqual({
        refused: "key",
      });
    }
  });

  it("asks letters, digits, Space and arrows for Ctrl and one more modifier", () => {
    const refused = { refused: "modifiers" };
    expect(toAccelerator(press("s", "KeyS"), "windows")).toEqual(refused);
    expect(
      toAccelerator(press("s", "KeyS", { ctrlKey: true }), "windows"),
    ).toEqual(refused);
    expect(
      toAccelerator(
        press("s", "KeyS", { altKey: true, shiftKey: true }),
        "windows",
      ),
    ).toEqual(refused);
    expect(
      toAccelerator(press("1", "Digit1", { shiftKey: true }), "windows"),
    ).toEqual(refused);
    expect(toAccelerator(press(" ", "Space"), "windows")).toEqual(refused);
    expect(
      toAccelerator(press("ArrowUp", "ArrowUp", { ctrlKey: true }), "linux"),
    ).toEqual(refused);
  });

  it("refuses Ctrl+Alt without Shift off macOS, which is AltGr", () => {
    const ctrlAlt = { ctrlKey: true, altKey: true };
    expect(toAccelerator(press("q", "KeyQ", ctrlAlt), "windows")).toEqual({
      refused: "altGr",
    });
    expect(toAccelerator(press("q", "KeyQ", ctrlAlt), "linux")).toEqual({
      refused: "altGr",
    });
    expect(
      toAccelerator(
        press("q", "KeyQ", { ...ctrlAlt, shiftKey: true }),
        "windows",
      ),
    ).toEqual({ accelerator: "Ctrl+Alt+Shift+Q" });
    expect(toAccelerator(press("q", "KeyQ", ctrlAlt), "mac")).toEqual({
      accelerator: "Control+Alt+Q",
    });
  });

  it("refuses a press with AltGr off macOS", () => {
    expect(
      toAccelerator(
        press("@", "KeyQ", { ctrlKey: true, altKey: true, altGraph: true }),
        "windows",
      ),
    ).toEqual({ refused: "altGraph" });
    expect(
      toAccelerator(press("F1", "F1", { altGraph: true }), "linux"),
    ).toEqual({ refused: "altGraph" });
  });

  it("uses macOS's names there, with ⌘ or ⌃ as the Ctrl", () => {
    expect(
      toAccelerator(
        press("s", "KeyS", { metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual({ accelerator: "Shift+Command+S" });
    expect(
      toAccelerator(
        press("s", "KeyS", { ctrlKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual({ accelerator: "Control+Shift+S" });
    expect(
      toAccelerator(
        press("s", "KeyS", { ctrlKey: true, metaKey: true }),
        "mac",
      ),
    ).toEqual({ accelerator: "Control+Command+S" });
    expect(toAccelerator(press("s", "KeyS", { metaKey: true }), "mac")).toEqual(
      { refused: "modifiers" },
    );
  });

  it("names the Windows key Super elsewhere, and puts modifiers in one order", () => {
    expect(
      toAccelerator(
        press("s", "KeyS", {
          metaKey: true,
          shiftKey: true,
          altKey: true,
          ctrlKey: true,
        }),
        "windows",
      ),
    ).toEqual({ accelerator: "Ctrl+Alt+Shift+Super+S" });
    // The Windows key isn't a Ctrl
    expect(
      toAccelerator(
        press("s", "KeyS", { metaKey: true, shiftKey: true }),
        "linux",
      ),
    ).toEqual({ refused: "modifiers" });
  });
});

describe("acceleratorKeys", () => {
  it("names the keys as each platform does", () => {
    expect(acceleratorKeys("Ctrl+Shift+S", "windows")).toEqual([
      { text: "Ctrl" },
      { label: "Shift" },
      { text: "S" },
    ]);
    expect(acceleratorKeys("Ctrl+Super+Up", "windows")).toEqual([
      { text: "Ctrl" },
      { text: "Win" },
      { text: "↑" },
    ]);
    expect(acceleratorKeys("Ctrl+Super+Space", "linux")).toEqual([
      { text: "Ctrl" },
      { text: "Super" },
      { label: "Space" },
    ]);
    expect(acceleratorKeys("Control+Alt+Command+K", "mac")).toEqual([
      { label: "Control" },
      { label: "Option" },
      { label: "Command" },
      { text: "K" },
    ]);
    expect(acceleratorKeys("num7", "windows")).toEqual([{ text: "Num 7" }]);
    expect(acceleratorKeys("numadd", "windows")).toEqual([{ text: "Num +" }]);
    expect(acceleratorKeys("MediaPlayPause", "linux")).toEqual([
      { label: "MediaPlayPause" },
    ]);
  });
});
