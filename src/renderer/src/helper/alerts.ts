import { AlertMedia } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { AudioQueue, EnqueueOptions } from "./audio";

type QueuedAlert = {
  // The alert, whose overlay shows its media at the media's volume
  id: string;
  // None when the alert only shows media
  data?: Uint8Array;
  media?: AlertMedia;
};

/**
 * Queues an alert's sound, or a silent place when it only shows media. Its
 * media goes to main once its place is known, and main shows it on the
 * alert's overlay when its turn comes.
 */
export function queueAlert(
  queue: AudioQueue,
  { id, data, media }: QueuedAlert,
  options: EnqueueOptions = {},
): Promise<boolean> {
  if (!media) {
    return data ? queue.enqueue(data, options) : Promise.resolve(false);
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
      }),
  };
  return data ? queue.enqueue(data, item) : queue.wait(media.duration, item);
}
