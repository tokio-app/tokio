import { APP_EVENTS, APP_EVENTS_RESPONSE, VoiceData } from "@/common/types";
import { VOICE_SAMPLE, voiceKey } from "@/helper/voices";
import { useAudio } from "@/hooks/useAudio";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useEffect, useRef, useState } from "react";

// Test ids of the previews, so the TTS page's tester is ignored
const ID_PREFIX = "voice-preview:";

/**
 * Speaks a sample line with one voice at a time. Previewing a voice cancels
 * the one playing, and `previewing` holds the key of the voice loading or
 * playing.
 */
export function useVoicePreview({
  speed,
  pitch,
}: {
  speed: number;
  pitch: number;
}) {
  const { getQueue } = useAudio();
  const queue = getQueue("voice-preview");

  const [previewing, setPreviewing] = useState<string | null>(null);
  // Read by the IPC callback, which would otherwise see a stale `previewing`
  const current = useRef<string | null>(null);

  const finish = (key: string) => {
    if (current.current !== key) return;
    current.current = null;
    setPreviewing(null);
  };

  // Previewing the voice playing stops it.
  const toggle = (voice: VoiceData) => {
    const key = voiceKey(voice);
    const playing = current.current === key;
    queue.stop();
    current.current = playing ? null : key;
    setPreviewing(current.current);
    if (playing) return;

    window.api.emit(APP_EVENTS.GET_TTS_TEST, {
      id: ID_PREFIX + key,
      text: VOICE_SAMPLE,
      voice,
    });
  };

  useIpcListener(APP_EVENTS_RESPONSE.GET_TTS_TEST, (res) => {
    if (!res?.id.startsWith(ID_PREFIX)) return;
    // Ignore previews that were replaced or stopped while loading.
    const key = res.id.slice(ID_PREFIX.length);
    if (key !== current.current) return;
    if (!res.success || !res.data) {
      finish(key);
      return;
    }

    queue.stop();
    void queue
      .enqueue(res.data, true, { speed, pitch, onEnded: () => finish(key) })
      .then((queued) => {
        if (!queued) finish(key);
      });
  });

  // Closing the picker cuts the preview.
  useEffect(() => () => queue.stop(), [queue]);

  return { previewing, toggle };
}
