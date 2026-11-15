import type { ChatTranslation } from "./connector";

// What Settings → Chat translation's tester shows for a message
export type TranslationTest =
  // A command or a chat trigger's keyword, which stays as typed
  | { kind: "command" }
  // Already in the language picked
  | { kind: "same"; from: string }
  | { kind: "translated"; translation: ChatTranslation };
