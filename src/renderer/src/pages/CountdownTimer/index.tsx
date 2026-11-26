import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { BackButton, Page, Section, Spinner } from "@/components";
import { PlatformsContext } from "@/context/platforms";
import { useIpcListener, useIpcRequest, useServerEnabled } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { rich, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTimerPush } from "./helper";
import { TimerSections } from "./sections/TimerSections";

export function CountdownTimer() {
  const t = useT();
  const serverEnabled = useServerEnabled();
  const timer = useTimerPush();
  // The rows follow the profile's platforms
  const [platforms, setPlatforms] = useState(defaultProfile.platforms);

  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (res?.success && res.profile) setPlatforms(res.profile.platforms);
  });

  return (
    <PlatformsContext value={platforms}>
      <Page width="wide" layout="aside">
        {!serverEnabled && (
          <p className={toolsStyles.notice}>
            {rich(t("tools.countdown.serverOff"), {
              link: (text) => <Link to="/settings">{text}</Link>,
            })}
          </p>
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
    </PlatformsContext>
  );
}
