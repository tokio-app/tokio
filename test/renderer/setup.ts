import "@testing-library/jest-dom/vitest";
import "./dom";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { installApi } from "./ipc";

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
