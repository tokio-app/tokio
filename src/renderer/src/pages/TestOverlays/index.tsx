import { TestOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Page } from "@/components";
import { useIpcListener, useIpcRequest, useServerEnabled } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { TestStatus } from "./helper";
import { TestOverlaysSection } from "./sections/TestOverlaysSection";

export function TestOverlays() {
  const t = useT();
  const [testOverlays, setTestOverlays] = useState<TestOverlay[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TestStatus>>({});

  useIpcRequest(APP_EVENTS.GET_TEST_OVERLAYS);
  const serverEnabled = useServerEnabled();

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

  return (
    <Page width="wide" layout="aside">
      {!serverEnabled && (
        <p className={toolsStyles.notice}>{t("tools.test.serverOff")}</p>
      )}

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
