import { TestOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Page } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { TestStatus, TimerPush } from "./helper";
import { TestOverlaysSection } from "./sections/TestOverlaysSection";
import { TimerSections } from "./sections/TimerSections";
import styles from "./tools.module.css";

export function Tools() {
  const [testOverlays, setTestOverlays] = useState<TestOverlay[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TestStatus>>({});
  const [serverEnabled, setServerEnabled] = useState(true);
  const [timer, setTimer] = useState<TimerPush | null>(null);

  useIpcRequest(APP_EVENTS.GET_TEST_OVERLAYS);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.GET_TIMER);

  useIpcListener(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, (res) => {
    if (res?.success) setTestOverlays(res.data!);
  });

  useIpcListener(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, (res) => {
    if (!res) return;
    setStatuses((s) => ({
      ...s,
      [res.id]: res.success ? "sent" : "no-client",
    }));
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setServerEnabled(res.data!.settings.server.enabled);
  });

  // A failed request keeps the last timer shown
  useIpcListener(APP_EVENTS_RESPONSE.TIMER, (res) => {
    if (res?.success && res.data) {
      setTimer({ data: res.data, at: performance.now() });
    }
  });

  return (
    <Page width="wide" layout="aside">
      {!serverEnabled && (
        <p className={styles.notice}>
          The overlay server is off. Enable it in Settings to show the timer on
          stream and send test events.
        </p>
      )}

      {timer && <TimerSections timer={timer} />}

      <TestOverlaysSection
        overlays={testOverlays}
        statuses={statuses}
        onCreate={(name) => {
          window.api.emit(APP_EVENTS.ADD_TEST_OVERLAY, { name });
        }}
        onRemove={(id) => {
          window.api.emit(APP_EVENTS.REMOVE_TEST_OVERLAY, { id });
        }}
        onTest={(id) => {
          window.api.emit(APP_EVENTS.SEND_TEST_EVENTS, { id });
        }}
      />
    </Page>
  );
}
