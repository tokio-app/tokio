import Logo from "@/assets/logo.png";
import { AboutInfo, UpdateStatus } from "@/common/types";
import { REPOSITORY_URL } from "@/common/util";
import { Btn, Section, UpdateButton } from "@/components";
import { FiCode, FiFileText, FiRefreshCw } from "react-icons/fi";
import styles from "../about.module.css";
import { COPYRIGHT, updateText } from "../helper";

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
  const busy =
    checking || update.state === "checking" || update.state === "downloading";
  return (
    <Section>
      <div className={styles.app}>
        <img className={styles.logo} src={Logo} alt="" />
        <div className={styles.app_info}>
          <h3 className={styles.app_name}>Tokio</h3>
          <p className={styles.muted}>
            Version {__APP_VERSION__}
            {versions &&
              ` · Electron ${versions.electron} · Chromium ${versions.chrome} · Node ${versions.node}`}
          </p>
          <p className={styles.muted}>{COPYRIGHT}</p>
        </div>
      </div>

      <div className={styles.update}>
        <p className={checkError ? styles.update_error : styles.muted}>
          {checkError ?? updateText(update)}
        </p>
        <div className={styles.update_actions}>
          <UpdateButton status={update} connected={connected} />
          {update.state !== "ready" && (
            <Btn
              loading={busy}
              disabled={update.state === "unsupported"}
              onClick={onCheck}
            >
              <FiRefreshCw /> Check for updates
            </Btn>
          )}
        </div>
      </div>

      <div className={styles.notice}>
        <p>
          Tokio is free software under the MIT License: you may use, copy,
          modify and redistribute it under its terms. One file, derived from
          edge-tts, is licensed under the GNU LGPL v3.0, and the third-party
          components keep their own licenses.
        </p>
        <p>
          Tokio comes with <strong>absolutely no warranty</strong>, to the
          extent permitted by applicable law. See the license for details.
        </p>
        <p>
          The complete source code of every release is published at{" "}
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            {REPOSITORY_URL.replace(/^https:\/\//, "")}
          </a>
          .
        </p>
      </div>

      <div className={styles.buttons}>
        <Btn onClick={() => window.open(REPOSITORY_URL)}>
          <FiCode /> Source code
        </Btn>
        <Btn onClick={() => onView("tokio")}>
          <FiFileText /> MIT license
        </Btn>
        <Btn onClick={() => onView("notices")}>
          <FiFileText /> Third-party notices
        </Btn>
      </div>
    </Section>
  );
}
