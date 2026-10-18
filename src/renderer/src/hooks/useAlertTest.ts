import { APP_EVENTS, APP_EVENTS_RESPONSE, AppEventsMap } from "@/common/types";
import type { TestState } from "@/components/PlayButton";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudio } from "./useAudio";

export type AlertTestRequest = AppEventsMap[APP_EVENTS.TEST_ALERT];

/**
 * Plays one alert sound test at a time. Starting a test cancels the one
 * playing, and `testing` holds the test loading or playing.
 */
export function useAlertTest() {
  const { getQueue } = useAudio();
  const queue = getQueue("alert-test");

  const [testing, setTesting] = useState<TestState>(null);
  // Read by IPC callbacks, which would otherwise see a stale `testing`
  const current = useRef<string | null>(null);

  const finish = useCallback((id: string) => {
    if (current.current !== id) return;
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

  const play = useCallback(
    (req: AlertTestRequest) => {
      queue.stop();
      current.current = req.id;
      setTesting({ id: req.id, loading: true });
      window.api.emit(APP_EVENTS.TEST_ALERT, req);
    },
    [queue],
  );

  const toggle = useCallback(
    (req: AlertTestRequest) => {
      if (current.current === req.id) stop();
      else play(req);
    },
    [play, stop],
  );

  useEffect(() => {
    const removeTestAlert = window.api.on(
      APP_EVENTS_RESPONSE.TEST_ALERT,
      (res) => {
        // Ignore tests that were replaced or stopped while loading.
        if (!res || res.id !== current.current) return;
        if (!res.success || !res.data) {
          finish(res.id);
          return;
        }

        queue.stop();
        void queue
          .enqueue(res.data, true, {
            gain: res.volume / 100,
            key: res.id,
            onEnded: () => finish(res.id),
            ...res.filters,
          })
          .then((queued) => {
            if (!queued) finish(res.id);
            else started(res.id);
          });
      },
    );

    return () => {
      removeTestAlert();
      queue.stop();
    };
  }, [queue, finish, started]);

  return { testing, toggle, stop };
}
