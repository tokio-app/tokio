import { AlertMedia } from "@/common/schemas";
import {
  AlertTestSource,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
} from "@/common/types";
import type { TestState } from "@/components/PlayButton";
import { queueAlert } from "@/helper/alerts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudio } from "./useAudio";

// A sound or message, which main reads or speaks, or an alert that only
// shows media. An alert's media shows on its overlay. A sound plays from
// start to end, the seconds of its cut.
export type AlertTestRequest =
  | (AlertTestSource & {
      id: string;
      volume: number;
      media?: AlertMedia;
      start?: number;
      end?: number;
    })
  | { id: string; volume: number; media: AlertMedia };

/**
 * Plays one alert sound test at a time. Starting a test cancels the one
 * playing, and `testing` holds the test loading or playing. `lengths` has the
 * seconds each sound or message tested lasts, by test id.
 */
export function useAlertTest() {
  const { getQueue } = useAudio();
  const queue = getQueue("alert-test");

  const [testing, setTesting] = useState<TestState>(null);
  const [lengths, setLengths] = useState<Record<string, number>>({});
  // Read by IPC callbacks, which would otherwise see a stale `testing`.
  // `request` numbers each play, so a late reply for an older one is dropped.
  const current = useRef<{ req: AlertTestRequest; request: number } | null>(
    null,
  );
  const requests = useRef(0);

  // By request, not id: a stopped test's sound still decoding resolves later,
  // and mustn't end the same alert's test started again
  const finish = useCallback((request: number) => {
    if (current.current?.request !== request) return;
    current.current = null;
    setTesting(null);
  }, []);

  // The test's audio is playing, it's no longer loading.
  const started = useCallback((request: number) => {
    const test = current.current;
    if (test?.request !== request) return;
    setTesting({ id: test.req.id, loading: false });
  }, []);

  const stop = useCallback(() => {
    current.current = null;
    setTesting(null);
    queue.stop();
  }, [queue]);

  const queueTest = useCallback(
    (
      req: AlertTestRequest,
      request: number,
      data?: Uint8Array,
      filters?: { speed: number; pitch: number },
    ) => {
      const { id, volume, media } = req;
      queue.stop();
      void queueAlert(
        queue,
        { id, data, media },
        {
          gain: volume / 100,
          key: id,
          onEnded: () => finish(request),
          // Media replaces it, its place isn't the sound's length.
          onScheduled: (_, seconds) =>
            setLengths((l) => ({ ...l, [id]: seconds })),
          ...("start" in req && { start: req.start, end: req.end }),
          ...filters,
        },
      ).then((queued) => (queued ? started(request) : finish(request)));
    },
    [queue, finish, started],
  );

  const play = useCallback(
    (req: AlertTestRequest) => {
      queue.stop();
      const request = ++requests.current;
      current.current = { req, request };
      setTesting({ id: req.id, loading: true });
      // Media alone needs nothing from main.
      if ("file" in req || "url" in req || "tts" in req) {
        window.api.emit(APP_EVENTS.TEST_ALERT, { ...req, request });
      } else {
        queueTest(req, request);
      }
    },
    [queue, queueTest],
  );

  const toggle = useCallback(
    (req: AlertTestRequest) => {
      if (current.current?.req.id === req.id) stop();
      else play(req);
    },
    [play, stop],
  );

  useEffect(() => {
    const removeTestAlert = window.api.on(
      APP_EVENTS_RESPONSE.TEST_ALERT,
      (res) => {
        const test = current.current;
        // Ignore tests that were replaced or stopped while loading.
        if (!res || res.id !== test?.req.id || res.request !== test.request)
          return;
        if (!res.success || !res.data) {
          finish(test.request);
          return;
        }
        queueTest(test.req, test.request, res.data, res.filters);
      },
    );

    return () => {
      removeTestAlert();
      queue.stop();
    };
  }, [queue, finish, queueTest]);

  return { testing, lengths, toggle, stop };
}
