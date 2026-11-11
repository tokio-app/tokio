import Logo from "@/assets/logo.png";
import { AboutInfo, UpdateStatus } from "@/common/types";
import { REPOSITORY_URL } from "@/common/util";
import { Btn, Section, UpdateButton } from "@/components";
import { formatPercent } from "@/helper/format";
import { rich, useLanguage, useT } from "@/ui/i18n";
import { FiCode, FiFileText, FiRefreshCw } from "react-icons/fi";
import styles from "../about.module.css";
import { COPYRIGHT, updateDetail, updateText } from "../helper";

type Props = {
  versions?: AboutInfo["versions"];
  update: UpdateStatus;
  // A check was asked for and hasn't been answered yet
  checking: boolean;
  checkError?: string;
  connected: boolean;
  onCheck: () => void;
  onView: (id: string) => void;
};

export function AppSection({
  versions,
  update,
  checking,
  checkError,
  connected,
  onCheck,
  onView,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const busy = checking || update.state === "checking";
  const detail = checkError ? undefined : updateDetail(update, language);
  return (
    <Section>
      <div className={styles.app}>
        <img className={styles.logo} src={Logo} alt="" />
        <div className={styles.app_info}>
          <h3 className={styles.app_name}>Tokio</h3>
          <p className={styles.muted}>
            {t("about.app.version", { version: __APP_VERSION__ })}
            {versions &&
              ` · Electron ${versions.electron} · Chromium ${versions.chrome} · Node ${versions.node}`}
          </p>
          <p className={styles.muted}>{COPYRIGHT}</p>
        </div>
      </div>

      <div className={styles.update}>
        <div className={styles.update_text}>
          <p className={checkError ? styles.update_error : styles.update_title}>
            {checkError ?? updateText(update, language)}
          </p>
          {detail && <p className={styles.muted}>{detail}</p>}
        </div>
        {update.state === "downloading" ? (
          <>
            <span className={styles.update_percent}>
              {formatPercent(update.percent, language)}
            </span>
            <progress
              className={styles.update_progress}
              max={100}
              value={update.percent}
              aria-label={updateText(update, language)}
            />
          </>
        ) : (
          <div className={styles.update_actions}>
            <UpdateButton status={update} connected={connected} />
            {update.state !== "ready" && (
              <Btn
                loading={busy}
                disabled={update.state === "unsupported"}
                onClick={onCheck}
              >
                <FiRefreshCw /> {t("about.app.check")}
              </Btn>
            )}
          </div>
        )}
      </div>

      <div className={styles.notice}>
        <p>{t("about.app.license")}</p>
        <p>
          {rich(t("about.app.warranty"), {
            strong: (text) => <strong>{text}</strong>,
          })}
        </p>
        <p>
          {rich(t("about.app.source"), {
            link: (
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                {REPOSITORY_URL.replace(/^https:\/\//, "")}
              </a>
            ),
          })}
        </p>
      </div>

      <div className={styles.buttons}>
        <Btn onClick={() => window.open(REPOSITORY_URL)}>
          <FiCode /> {t("about.app.sourceCode")}
        </Btn>
        <Btn onClick={() => onView("tokio")}>
          <FiFileText /> {t("about.app.mitLicense")}
        </Btn>
        <Btn onClick={() => onView("notices")}>
          <FiFileText /> {t("about.app.notices")}
        </Btn>
      </div>
    </Section>
  );
}
