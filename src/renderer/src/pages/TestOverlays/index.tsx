import { TestOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { DeleteTestOverlayModal, Page } from "@/components";
import { useIpcListener, useIpcRequest, useServerEnabled } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TestStatus } from "./helper";
import { TestOverlaysSection } from "./sections/TestOverlaysSection";

export function TestOverlays() {
  const t = useT();
  const [testOverlays, setTestOverlays] = useState<TestOverlay[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TestStatus>>({});
  // The overlay waiting for the user to confirm it's deleted
  const [deleting, setDeleting] = useState<TestOverlay | null>(null);

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
        <p className={toolsStyles.notice}>
          {rich(t("tools.test.serverOff"), {
            link: (text) => <Link to="/settings">{text}</Link>,
          })}
        </p>
      )}

      <TestOverlaysSection
        overlays={testOverlays}
        statuses={statuses}
        onCreate={(name) => {
          window.api.emit(APP_EVENTS.ADD_TEST_OVERLAY, { name });
        }}
        onRemove={setDeleting}
        onTest={(id) => {
          window.api.emit(APP_EVENTS.SEND_TEST_EVENTS, { id });
        }}
      />

      {deleting && (
        <DeleteTestOverlayModal
          item={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  );
}
