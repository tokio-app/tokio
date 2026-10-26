import { AlertMedia } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { AudioQueue, EnqueueOptions } from "./audio";

type QueuedAlert = {
  // The alert, whose overlay shows its media at the media's volume
  id: string;
  // A message's audio
  data?: Uint8Array;
  // A library sound's file, fetched only when it isn't decoded yet. Without
  // it or data, the alert only shows media.
  key?: string;
  media?: AlertMedia;
};

/**
 * Asks main for a library sound's bytes, rejecting when it can't read them.
 */
export function soundData(file: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const off = window.api.on(APP_EVENTS_RESPONSE.SOUND_DATA, (res) => {
      if (!res || res.file !== file) return;
      off();
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error?.message ?? `Unable to read ${file}.`));
    });
    window.api.emit(APP_EVENTS.GET_SOUND_DATA, { file });
  });
}

/**
 * Queues an alert's sound, or a silent place when it only shows media. Its
 * media goes to main once its place is known, and main shows it on the
 * alert's overlay when its turn comes.
 */
export function queueAlert(
  queue: AudioQueue,
  { id, data, key, media }: QueuedAlert,
  options: EnqueueOptions = {},
): Promise<boolean> {
  const sound = data ?? (key ? () => soundData(key) : undefined);
  if (!media) {
    return sound ? queue.enqueue(sound, options) : Promise.resolve(false);
  }

  const item: EnqueueOptions = {
    ...options,
    minDuration: media.duration,
    onScheduled: (delay, duration) =>
      window.api.emit(APP_EVENTS.SHOW_ALERT_MEDIA, {
        id,
        file: media.file,
        delay,
        duration,
        volume: media.volume,
        start: media.start,
        end: media.end,
      }),
  };
  return sound ? queue.enqueue(sound, item) : queue.wait(media.duration, item);
}
