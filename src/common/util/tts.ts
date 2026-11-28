import type { Profile } from "@/common/schemas";

type Trigger = Profile["tts"]["format"]["trigger"];

// The prefix each chat TTS mode starts with, custom's the one it starts as
export const MODE_VALUES: Record<Trigger["mode"], string> = {
  any: "",
  dot: ".",
  slash: "/",
  custom: "!tts",
};

/**
 * What a chat must start with to be read: "" for any, the typed value for
 * custom. Dot and slash take their own prefix whatever value was saved, so a
 * mode saved without its value (an MCP change) still reads.
 */
export function triggerPrefix(trigger: Trigger): string {
  return trigger.mode === "custom" ? trigger.value : MODE_VALUES[trigger.mode];
}
