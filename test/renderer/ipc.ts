import type {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
} from "@/common/types";
import { act } from "@testing-library/react";
import { vi } from "vitest";

type Listener = (data?: unknown) => void;

let listening = new Map<APP_EVENTS_RESPONSE, Set<Listener>>();
let emit = vi.fn<Window["api"]["emit"]>();

/**
 * Puts a fresh window.api in place, the bridge the preload script exposes.
 * The setup calls it before each test.
 */
export function installApi() {
  listening = new Map();
  emit = vi.fn<Window["api"]["emit"]>();

  window.api = {
    emit,
    on: (event, callback) => {
      // Wrapped like ipcRenderer.on, so the same callback can listen twice.
      // Tests send what the event carries, send() checks it.
      const listener: Listener = (data?: any) => callback(data);
      const set = listening.get(event) ?? new Set();
      listening.set(event, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}

/**
 * A reply or push from main. Runs the subscribed listeners inside act, so
 * the updates they cause are rendered.
 */
export async function send<T extends APP_EVENTS_RESPONSE>(
  event: T,
  data?: AppEventsResponseMap[T],
) {
  await act(async () => {
    for (const listener of [...(listening.get(event) ?? [])]) listener(data);
  });
}

/** What the renderer sent with an event, oldest first. */
export function sent<T extends APP_EVENTS>(event: T): AppEventsMap[T][] {
  return emit.mock.calls
    .filter((call): call is [T, AppEventsMap[T]] => call[0] === event)
    .map(([, data]) => data);
}

/** Every event the renderer sent, in order. */
export function sentEvents(): APP_EVENTS[] {
  return emit.mock.calls.map(([name]) => name);
}

/** How many listeners a response has, to check they're removed. */
export function listeners(event: APP_EVENTS_RESPONSE) {
  return listening.get(event)?.size ?? 0;
}
