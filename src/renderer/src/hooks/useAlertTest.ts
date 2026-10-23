import { AlertMedia } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, AppEventsMap } from "@/common/types";
import type { TestState } from "@/components/PlayButton";
import { queueAlert } from "@/helper/alerts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudio } from "./useAudio";

// A sound or message, which main reads or speaks, or an alert that only
// shows media. An alert's media shows on its overlay.
export type AlertTestRequest =
  | (AppEventsMap[APP_EVENTS.TEST_ALERT] & { media?: AlertMedia })
  | { id: string; volume: number; media: AlertMedia };

/**
 * Plays one alert sound test at a time. Starting a test cancels the one
 * playing, and `testing` holds the test loading or playing.
 */
export function useAlertTest() {
  const { getQueue } = useAudio();
  const queue = getQueue("alert-test");

  const [testing, setTesting] = useState<TestState>(null);
  // Read by IPC callbacks, which would otherwise see a stale `testing`
  const current = useRef<AlertTestRequest | null>(null);

  const finish = useCallback((id: string) => {
    if (current.current?.id !== id) return;
    current.current = null;
    setTesting(null);
  }, []);

  // The test's audio is playing, it's no longer loading.
  const started = useCallback((id: string) => {
    setTesting((t) => (t?.id === id ? { id, loading: false } : t));
  }, []);

  const stop = useCallback(() => {
    current.current = null;
    setTesting(null);
    queue.stop();
  }, [queue]);

  const queueTest = useCallback(
    (
      { id, volume, media }: AlertTestRequest,
      data?: Uint8Array,
      filters?: { speed: number; pitch: number },
    ) => {
      queue.stop();
      void queueAlert(
        queue,
        { id, volume, data, media },
        { gain: volume / 100, key: id, onEnded: () => finish(id), ...filters },
      ).then((queued) => (queued ? started(id) : finish(id)));
    },
    [queue, finish, started],
  );

  const play = useCallback(
    (req: AlertTestRequest) => {
      queue.stop();
      current.current = req;
      setTesting({ id: req.id, loading: true });
      // Media alone needs nothing from main.
      if ("file" in req || "url" in req || "tts" in req) {
        window.api.emit(APP_EVENTS.TEST_ALERT, req);
      } else {
        queueTest(req);
      }
    },
    [queue, queueTest],
  );

  const toggle = useCallback(
    (req: AlertTestRequest) => {
      if (current.current?.id === req.id) stop();
      else play(req);
    },
    [play, stop],
  );

  useEffect(() => {
    const removeTestAlert = window.api.on(
      APP_EVENTS_RESPONSE.TEST_ALERT,
      (res) => {
        const req = current.current;
        // Ignore tests that were replaced or stopped while loading.
        if (!res || res.id !== req?.id) return;
        if (!res.success || !res.data) {
          finish(res.id);
          return;
        }
        queueTest(req, res.data, res.filters);
      },
    );

    return () => {
      removeTestAlert();
      queue.stop();
    };
  }, [queue, finish, queueTest]);

  return { testing, toggle, stop };
}
