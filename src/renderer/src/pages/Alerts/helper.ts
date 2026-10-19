import { Alert, AlertTts, Profile, SavedEmote } from "@/common/schemas";
import { CustomGift, TOKIO_EVENTS } from "@/common/types";
import { SelectOption } from "@/components";

export function createAlert(): Alert {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    trigger: {
      type: TOKIO_EVENTS.FOLLOW,
      gifts: [],
      emotes: [],
      keyword: "",
      user: "",
    },
    sound: null,
    tts: null,
    volume: 100,
  };
}

// A new TTS message starts with the TTS page's voice, speed and pitch.
export function ttsDefaultsOf(tts: Profile["tts"]): Omit<AlertTts, "message"> {
  return {
    voice: tts.voice,
    speed: tts.filters.speed,
    pitch: tts.filters.pitch,
  };
}

// TikTok doesn't name emotes, they're numbered in the order they appeared.
export function emoteOptions(emotes: SavedEmote[]): SelectOption<string>[] {
  return emotes.map((emote, index) => ({
    value: emote.id,
    label: `Emote ${index + 1}`,
    img: emote.image,
  }));
}

// TikTok's gifts and the ones seen in LIVEs that it doesn't list, cheapest
// first. A gift TikTok lists later keeps TikTok's details.
export function giftOptions(
  gifts: CustomGift[],
  custom: CustomGift[],
): CustomGift[] {
  const listed = new Set(gifts.map((gift) => gift.value));
  return [...gifts, ...custom.filter((gift) => !listed.has(gift.value))].sort(
    (a, b) => a.coins - b.coins || a.label.localeCompare(b.label),
  );
}
