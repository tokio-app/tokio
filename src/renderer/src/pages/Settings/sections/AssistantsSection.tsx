import { RemoteSettings } from "@/common/schemas";
import { MCP_URL } from "@/common/util";
import { Btn, CopyField, Field, Section, Select } from "@/components";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { LuBot } from "react-icons/lu";
import { ASSISTANTS } from "../helper";
import styles from "../settings.module.css";

interface Props {
  // Remote control's switch and key, which MCP shares
  remote: RemoteSettings;
  // MCP answers on the overlay server
  serverEnabled: boolean;
}

export function AssistantsSection({ remote, serverEnabled }: Props) {
  const t = useT();
  // Hidden until asked, like the remote's key: each setup carries it
  const [shown, setShown] = useState(false);
  const [name, setName] = useState(ASSISTANTS[0].name);
  const assistant = ASSISTANTS.find((a) => a.name === name) ?? ASSISTANTS[0];

  return (
    <Section
      icon={<LuBot />}
      title={t("settings.assistants.title")}
      description={t("settings.assistants.description")}
    >
      {!remote.enabled ? (
        <p className={styles.note}>{t("settings.assistants.remoteOff")}</p>
      ) : (
        !serverEnabled && (
          <p className={styles.note}>{t("settings.assistants.serverOff")}</p>
        )
      )}
      {/* The key comes with main's echo of the settings. One button whose
          text changes, so the focus stays on it. */}
      {remote.enabled && remote.key && (
        <>
          <div>
            <Btn onClick={() => setShown(!shown)}>
              {t(shown ? "settings.remote.hide" : "settings.assistants.show")}
            </Btn>
          </div>
          {shown && (
            <div className={styles.remote_ai}>
              <Field label={t("settings.remote.mcp")}>
                <CopyField
                  value={MCP_URL}
                  title={t("settings.remote.copyMcp")}
                />
              </Field>
              <Field label={t("settings.remote.assistant")}>
                <Select
                  aria-label={t("settings.remote.assistant")}
                  options={ASSISTANTS.map((a) => ({
                    label: a.name,
                    value: a.name,
                  }))}
                  value={assistant.name}
                  onChange={setName}
                />
                <CopyField
                  code
                  value={assistant.setup(remote.key)}
                  title={t("settings.remote.copySetup", {
                    name: assistant.name,
                  })}
                />
                <p className={styles.note}>
                  {t(assistant.where, { file: assistant.file ?? "" })}
                </p>
              </Field>
              <p className={styles.note}>{t("settings.remote.mcpNote")}</p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
