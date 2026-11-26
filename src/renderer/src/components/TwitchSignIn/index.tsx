import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { useIpcListener } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FaTwitch } from "react-icons/fa";
import { Btn, Spinner } from "../Elements";
import { Modal } from "../Modal";
import styles from "./twitchsignin.module.css";

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
        <div className={styles.code}>
          <span className={styles.label}>{t("settings.twitch.code")}</span>
          <div className={styles.value}>
            <span className={styles.digits}>
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

/**
 * Sign in with Twitch: a device code the streamer types at Twitch's page.
 * Main sends the account as TWITCH_ACCOUNT, which the caller listens to, and
 * the failures as notices. Signing out is Settings'.
 */
export function TwitchSignIn() {
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
    <div>
      {signingIn && <SignInModal code={code} onCancel={cancel} />}
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
  );
}
