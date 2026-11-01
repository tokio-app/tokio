import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { BackButton, Page, Section, Spinner } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { TimerPush } from "./helper";
import { TimerSections } from "./sections/TimerSections";

export function CountdownTimer() {
  const t = useT();
  const [serverEnabled, setServerEnabled] = useState(true);
  const [timer, setTimer] = useState<TimerPush | null>(null);

  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.GET_TIMER);

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
        <p className={toolsStyles.notice}>{t("tools.countdown.serverOff")}</p>
      )}

      {timer ? (
        <TimerSections timer={timer} />
      ) : (
        // The header until the timer comes, so the page can go back
        <Section
          icon={<BackButton to="/tools" title={t("tools.back")} />}
          title={t("tools.countdown.title")}
          description={t("tools.countdown.description")}
        >
          <div className={toolsStyles.loading}>
            <Spinner size={20} />
          </div>
        </Section>
      )}
    </Page>
  );
}
