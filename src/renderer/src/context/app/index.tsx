import Logo from "@/assets/logo.png";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { queueAlert } from "@/helper/alerts";
import { useAudio } from "@/hooks/useAudio";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import styles from "@/router/Layout/layout.module.css";
import { TitleBar } from "@/ui/TitleBar";
import React, { useEffect, useState } from "react";

/**
 * Renders the app once main has loaded, then asks main to show this window in
 * place of the splash window. Also plays the audio main sends for TTS and
 * alerts on any page.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  // Null until main has loaded
  const [started, setStarted] = useState<boolean | null>(null);

  const { getQueue, stopQueues } = useAudio();

  useIpcRequest(APP_EVENTS.LOAD_APP);

  useIpcListener(APP_EVENTS_RESPONSE.LOAD_APP, (res) =>
    setStarted(!!res?.success),
  );

  useEffect(() => {
    if (started !== null) window.api.emit(APP_EVENTS.SHOW_WINDOW);
  }, [started]);

  useIpcListener(APP_EVENTS_RESPONSE.TTS_AUDIO, (res) => {
    if (!res) return;
    const queue = getQueue("tts_data");
    queue.setQueueOptions(res.queueOptions);
    queue.setFilters({ volume: res.filters.volume / 100 });
    // Main makes the next message once this one is done. onEnded doesn't run
    // when the queue is stopped, and main forgets the message then.
    const done = () => window.api.emit(APP_EVENTS.TTS_PLAYED, { id: res.id });
    // Per message, so a change of speed or pitch spares the queued ones
    queue
      .enqueue(res.data, {
        speed: res.filters.speed,
        pitch: res.filters.pitch,
        onEnded: done,
      })
      .then((queued) => {
        if (!queued) done();
      });
  });

  useIpcListener(APP_EVENTS_RESPONSE.TTS_CLEAR, () => stopQueues("tts_data"));

  useIpcListener(APP_EVENTS_RESPONSE.ALERT_AUDIO, (res) => {
    if (!res) return;
    const queue = getQueue(res.channel);
    queue.setQueueOptions({ maxQueueLength: res.maxQueueLength, gapTime: 0.2 });
    void queueAlert(queue, res, {
      gain: res.volume / 100,
      key: res.id,
      cacheKey: res.key,
      ...res.filters,
    });
  });

  useIpcListener(APP_EVENTS_RESPONSE.ALERT_CLEAR, () => stopQueues("alerts"));

  if (started === null) return null;
  // The pages can't load the profile, and would save its defaults over it
  if (!started) {
    return (
      <div className={styles.container}>
        <TitleBar target="main" logo={Logo} />
        <main className={styles.content}>
          <p>Tokio couldn't start. Check the logs folder for details.</p>
        </main>
      </div>
    );
  }
  return children;
}
