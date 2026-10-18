import { VoiceData, VoiceEngine } from "@/common/types";
import type { SelectOption } from "@/components/Elements";

export const voiceKey = (voice: VoiceData) =>
  `${voice.engine}|${voice.lang}|${voice.name}`;

// Voices grouped by engine and language, in the order the groups first appear.
export function voiceOptions(
  voices: VoiceData[],
  engines: VoiceEngine[],
): SelectOption<string>[] {
  const labels = new Map(engines.map((e) => [e.id, e.label]));
  const groups = new Map<string, SelectOption<string>[]>();
  for (const voice of voices) {
    const group = `${labels.get(voice.engine) ?? voice.engine} · ${voice.lang}`;
    const options = groups.get(group) ?? [];
    options.push({ value: voiceKey(voice), label: voice.name, group });
    groups.set(group, options);
  }
  return [...groups.values()].flat();
}
