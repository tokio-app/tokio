import {
  Alert,
  AlertSound,
  AlertTts,
  Profile,
  SavedEmote,
} from "@/common/schemas";
import { CustomGift, TOKIO_EVENTS } from "@/common/types";
import { defaultAlertName } from "@/common/util";
import { EmoteOption } from "@/components";

// A new alert, named by its place in the list
export function createAlert(index = 0): Alert {
  return {
    id: crypto.randomUUID(),
    name: defaultAlertName(index),
    enabled: true,
    trigger: {
      type: TOKIO_EVENTS.FOLLOW,
      gifts: [],
      every_gift: false,
      emotes: [],
      keyword: "",
      user: "",
      min_coins: 0,
      roles: [],
    },
    sound: null,
    tts: null,
    media: null,
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
export function emoteOptions(emotes: SavedEmote[]): EmoteOption[] {
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

/**
 * A sound picked for an alert, played whole. The alert's own sound again
 * keeps its cut.
 */
export function soundClip(
  sound: AlertSound,
  current: Alert["sound"],
): NonNullable<Alert["sound"]> {
  if (current?.file === sound.file) return { ...current, name: sound.name };
  return { ...sound, start: 0, end: null };
}

/**
 * The sound's loudness in `bars` slices, each its loudest sample over every
 * channel, 1 for the loudest slice.
 */
export function waveform(
  buffer: Pick<AudioBuffer, "length" | "numberOfChannels" | "getChannelData">,
  bars: number,
): number[] {
  const peaks = new Array<number>(bars).fill(0);
  const size = buffer.length / bars;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let bar = 0; bar < bars; bar++) {
      const from = Math.floor(bar * size);
      const to = Math.max(from + 1, Math.floor((bar + 1) * size));
      for (let i = from; i < to && i < samples.length; i++) {
        peaks[bar] = Math.max(peaks[bar], Math.abs(samples[i]));
      }
    }
  }
  const loudest = Math.max(...peaks);
  return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks;
}
