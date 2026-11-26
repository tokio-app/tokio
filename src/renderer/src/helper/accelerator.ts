export type Platform = "mac" | "windows" | "linux";

// What a keydown carries, with AltGraph from getModifierState
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  altGraph: boolean;
}

// Why a press can't be a global shortcut
export type Refusal = "key" | "modifiers" | "altGr" | "altGraph";

export type Recorded = { accelerator: string } | { refused: Refusal } | null;

// What navigator.keyboard.getLayoutMap() resolves to
export type LayoutMap = Pick<Map<string, string>, "get">;

const MODIFIER_KEYS = new Set([
  "Control",
  "Alt",
  "AltGraph",
  "Shift",
  "Meta",
  "OS",
]);

// The numpad by its place, needing modifiers like the rest: a global num1
// would stop the numpad typing 1 in every app
const NUMPAD: Record<string, string> = {
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
};
const MEDIA: Record<string, string> = {
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  MediaPlayPause: "MediaPlayPause",
  MediaStop: "MediaStop",
  AudioVolumeUp: "VolumeUp",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
};
// Keys that need modifiers, by e.key
const NAMED: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Delete: "Delete",
};

export function currentPlatform(): Platform {
  const agent = navigator.userAgent;
  if (agent.includes("Mac")) return "mac";
  return agent.includes("Windows") ? "windows" : "linux";
}

// The Keyboard API, which TypeScript's DOM types leave out
declare global {
  interface Navigator {
    keyboard?: { getLayoutMap(): Promise<LayoutMap> };
  }
}

let layout: Promise<LayoutMap | undefined> | undefined;

// The keyboard layout, read once. Undefined where Chromium can't tell.
export function keyboardLayout() {
  const { keyboard } = navigator;
  layout ??= keyboard
    ? keyboard.getLayoutMap().catch(() => undefined)
    : Promise.resolve(undefined);
  return layout;
}

// The key part of the accelerator, and whether it may stand alone
function keyName(
  press: KeyPress,
  map?: LayoutMap,
): { name: string; alone: boolean } | null {
  const { key, code } = press;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) {
    // F1 to F12 act in most apps (F5 reloads, Alt+F4 closes)
    return { name: key, alone: Number(key.slice(1)) >= 13 };
  }
  // With Num Lock off a digit's key is End, Home…, handled as those below
  if (/^Numpad\d$/.test(code) && /^\d$/.test(key)) {
    return { name: `num${code.slice(6)}`, alone: false };
  }
  if (NUMPAD[code]) return { name: NUMPAD[code], alone: false };
  // Media keys and F13 to F24 stand alone: no app types with them, and macro
  // pads and Stream Deck hotkeys send them
  if (MEDIA[key]) return { name: MEDIA[key], alone: true };
  if (NAMED[key]) return { name: NAMED[key], alone: false };
  if (code === "Space") return { name: "Space", alone: false };
  // The number row by its place: Shift+1 types !, and AZERTY's types &
  if (/^Digit\d$/.test(code)) return { name: code.slice(5), alone: false };
  // The letter the key types on this layout, never its place on a US one
  const letter = map?.get(code) ?? key;
  if (/^[a-z]$/i.test(letter)) {
    return { name: letter.toUpperCase(), alone: false };
  }
  return null;
}

/**
 * A keydown as an Electron accelerator for a global shortcut, or why it
 * can't be one. Null while only modifiers are held.
 */
export function toAccelerator(
  press: KeyPress,
  platform: Platform,
  map?: LayoutMap,
): Recorded {
  if (MODIFIER_KEYS.has(press.key)) return null;
  const mac = platform === "mac";
  if (!mac && press.altGraph) return { refused: "altGraph" };

  const found = keyName(press, map);
  if (!found) return { refused: "key" };

  const { ctrlKey, altKey, shiftKey, metaKey } = press;
  const modifiers = [
    ctrlKey && (mac ? "Control" : "Ctrl"),
    altKey && "Alt",
    shiftKey && "Shift",
    metaKey && (mac ? "Command" : "Super"),
  ].filter((m): m is string => !!m);

  if (!found.alone) {
    // A global shortcut takes its keys from every app, so Ctrl+C and the
    // like must keep working everywhere
    const ctrl = ctrlKey || (mac && metaKey);
    if (!ctrl || modifiers.length < 2) return { refused: "modifiers" };
    // AltGr is Ctrl+Alt there, and types @, € and more on many layouts
    if (!mac && ctrlKey && altKey && !shiftKey) return { refused: "altGr" };
  }

  return { accelerator: [...modifiers, found.name].join("+") };
}

// How an accelerator's keys read, by the label's key in the locale files or
// as they are
const LABELS: Record<string, string> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  numadd: "Num +",
  numsub: "Num -",
  nummult: "Num *",
  numdiv: "Num /",
  numdec: "Num .",
};

// Keys whose name the locale files hold
const KEY_LABELS = [
  "Shift",
  "Space",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "MediaNextTrack",
  "MediaPreviousTrack",
  "MediaPlayPause",
  "MediaStop",
  "VolumeUp",
  "VolumeDown",
  "VolumeMute",
  "Command",
  "Option",
  "Control",
] as const;
export type KeyLabel = (typeof KEY_LABELS)[number];

const isKeyLabel = (name: string): name is KeyLabel =>
  KEY_LABELS.some((label) => label === name);

/**
 * An accelerator's keys as the platform names them, each either a locale
 * key to translate or the text to show.
 */
export function acceleratorKeys(
  accelerator: string,
  platform: Platform,
): ({ label: KeyLabel } | { text: string })[] {
  return accelerator.split("+").map((part) => {
    let name = part;
    if (platform === "mac" && part === "Alt") name = "Option";
    if (platform === "windows" && part === "Super") return { text: "Win" };
    if (/^num\d$/.test(part)) return { text: `Num ${part.slice(3)}` };
    if (isKeyLabel(name)) return { label: name };
    return { text: LABELS[name] ?? name };
  });
}
