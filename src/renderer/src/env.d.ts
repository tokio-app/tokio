/// <reference types="vite/client" />

export {};

import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
} from "@/common/types";

declare global {
  // The version in package.json, set at build time
  const __APP_VERSION__: string;

  interface Window {
    api: {
      on: <T extends APP_EVENTS_RESPONSE>(
        event: T,
        callback: (data?: AppEventsResponseMap[T]) => void,
      ) => () => void;
      emit: <T extends APP_EVENTS>(event: T, data?: AppEventsMap[T]) => void;
    };
    // Chromium's Local Font Access API, which TypeScript's DOM types lack
    queryLocalFonts(): Promise<{ family: string }[]>;
  }
}
