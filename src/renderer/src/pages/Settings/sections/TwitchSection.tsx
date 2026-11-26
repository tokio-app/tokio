import { APP_EVENTS } from "@/common/types";
import { PLATFORM_LABELS } from "@/common/util";
import { Btn, Section, TwitchSignIn } from "@/components";
import { useT } from "@/ui/i18n";
import { FaTwitch } from "react-icons/fa";
import styles from "../settings.module.css";

interface Props {
  // The account signed in to, "" for none
  login: string;
}

// Signs in to Twitch with a device code, or out. Main sends the failures
// as notices.
export function TwitchSection({ login }: Props) {
  const t = useT();
  return (
    <Section
      icon={<FaTwitch />}
      title={PLATFORM_LABELS.twitch}
      description={t("settings.twitch.description")}
    >
      {login ? (
        <div className={styles.twitch_account}>
          <span>{t("settings.twitch.signedIn", { login })}</span>
          <Btn onClick={() => window.api.emit(APP_EVENTS.TWITCH_SIGN_OUT)}>
            {t("settings.twitch.signOut")}
          </Btn>
        </div>
      ) : (
        <TwitchSignIn />
      )}
    </Section>
  );
}
