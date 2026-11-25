import "@testing-library/jest-dom/vitest";
import "./dom";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { installApi } from "./ipc";

// The vmThreads pool runs each file in its own realm, but Node's
// structuredClone builds its copies with the outer realm's Object and Array.
// fast-deep-equal then calls equal data unequal (their constructors differ),
// so copies are rebuilt here as this realm's plain objects and arrays.
const outerClone = globalThis.structuredClone;
function inRealm(value: unknown): unknown {
  if (Array.isArray(value)) return Array.from(value, inRealm);
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value)?.constructor?.name === "Object"
  )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, inRealm(item)]),
    );
  return value;
}
globalThis.structuredClone = ((value, options) =>
  inRealm(outerClone(value, options))) as typeof structuredClone;

// Tone.js logs its version when it's imported.
Object.assign(globalThis, { TONE_SILENCE_LOGGING: true });

// Testing Library advances fake timers only when it sees Jest's, so with
// Vitest's its async helpers and user-event would wait forever.
Object.assign(globalThis, {
  jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
});

beforeEach(() => {
  installApi();
});

// Testing Library only cleans up by itself when Vitest's globals are on.
afterEach(() => {
  cleanup();
});
