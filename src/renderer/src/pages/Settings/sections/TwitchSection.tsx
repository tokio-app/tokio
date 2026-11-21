import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { PLATFORM_LABELS } from "@/common/util";
import { Btn, Modal, Section, Spinner } from "@/components";
import { useIpcListener } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FaTwitch } from "react-icons/fa";
import styles from "../settings.module.css";

interface Props {
  // The account signed in to, "" for none
  login: string;
}

type Code = { code: string; uri: string };

// While a sign-in waits for the streamer at Twitch's page: the code, hidden
// until asked since streamers show their screen, and a viewer who typed it
// would sign Tokio in to their own account
function SignInModal({
  code,
  onCancel,
}: {
  code: Code | null;
  onCancel: () => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <Modal
      title={t("settings.twitch.signIn")}
      description={t("settings.twitch.finish")}
      onClose={onCancel}
      footer={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>}
    >
      {code ? (
        <div className={styles.twitch_code}>
          <span className={styles.twitch_label}>
            {t("settings.twitch.code")}
          </span>
          <div className={styles.twitch_value}>
            <span className={styles.twitch_digits}>
              {shown ? code.code : "•".repeat(code.code.length)}
            </span>
            <Btn onClick={() => setShown(!shown)}>
              {t(shown ? "settings.twitch.hide" : "settings.twitch.show")}
            </Btn>
          </div>
          <p className={styles.note}>{t("settings.twitch.codeNote")}</p>
          <a
            className={styles.link}
            href={code.uri}
            target="_blank"
            rel="noreferrer"
          >
            {t("settings.twitch.openAgain")}
          </a>
        </div>
      ) : (
        <Spinner />
      )}
    </Modal>
  );
}

// Signs in to Twitch with a device code, or out. Main sends the failures
// as notices.
export function TwitchSection({ login }: Props) {
  const t = useT();
  const [signingIn, setSigningIn] = useState(false);
  const [code, setCode] = useState<Code | null>(null);

  useIpcListener(APP_EVENTS_RESPONSE.TWITCH_CODE, (res) => {
    if (res) setCode({ code: res.code, uri: res.uri });
  });

  // Signed in, failed or canceled: the wait is over
  useIpcListener(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, () => {
    setSigningIn(false);
    setCode(null);
  });

  const cancel = () => {
    setSigningIn(false);
    setCode(null);
    // Also ends the sign-in waiting
    window.api.emit(APP_EVENTS.TWITCH_SIGN_OUT);
  };

  return (
    <Section
      icon={<FaTwitch />}
      title={PLATFORM_LABELS.twitch}
      description={t("settings.twitch.description")}
    >
      {signingIn && <SignInModal code={code} onCancel={cancel} />}
      {login ? (
        <div className={styles.twitch_account}>
          <span>{t("settings.twitch.signedIn", { login })}</span>
          <Btn onClick={() => window.api.emit(APP_EVENTS.TWITCH_SIGN_OUT)}>
            {t("settings.twitch.signOut")}
          </Btn>
        </div>
      ) : (
        <div>
          <Btn
            onClick={() => {
              setCode(null);
              setSigningIn(true);
              window.api.emit(APP_EVENTS.TWITCH_SIGN_IN);
            }}
          >
            <FaTwitch size={16} aria-hidden />
            {t("settings.twitch.signIn")}
          </Btn>
        </div>
      )}
    </Section>
  );
}
