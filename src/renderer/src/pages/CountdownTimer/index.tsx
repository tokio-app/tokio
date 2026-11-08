import { BackButton, Page, Section, Spinner } from "@/components";
import { useServerEnabled } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useT } from "@/ui/i18n";
import { useTimerPush } from "./helper";
import { TimerSections } from "./sections/TimerSections";

export function CountdownTimer() {
  const t = useT();
  const serverEnabled = useServerEnabled();
  const timer = useTimerPush();

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
