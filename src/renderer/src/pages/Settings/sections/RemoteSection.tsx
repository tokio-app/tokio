import { RemoteSettings } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getRemoteURL, MCP_URL } from "@/common/util";
import {
  Btn,
  Check,
  CopyField,
  Field,
  QRCode,
  Section,
  Select,
} from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiRefreshCw } from "react-icons/fi";
import { LuSmartphone } from "react-icons/lu";
import styles from "../settings.module.css";

// What sets Tokio up in Claude Code, key included
const mcpCommand = (key: string) =>
  `claude mcp add --transport http tokio ${MCP_URL} --header "Authorization: Bearer ${key}"`;

interface Props {
  remote: RemoteSettings;
  // The phone reaches Tokio through the overlay server
  serverEnabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function RemoteSection({ remote, serverEnabled, onChange }: Props) {
  const t = useT();
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [picked, setPicked] = useState("");
  // Hidden until asked, as OBS hides stream keys: streamers show their screen
  const [shown, setShown] = useState(false);

  useIpcRequest(APP_EVENTS.GET_NETWORK_ADDRESSES);
  useIpcListener(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, (res) => {
    if (res) setAddresses(res.addresses);
  });

  const host = addresses?.includes(picked) ? picked : addresses?.[0];
  const link = host ? getRemoteURL(host, remote.key) : "";

  const details = shown ? (
    <div className={styles.remote}>
      {link && <QRCode value={link} label={t("settings.remote.qr")} />}
      <div className={styles.remote_fields}>
        {addresses?.length === 0 && (
          <p className={styles.note}>{t("settings.remote.noAddress")}</p>
        )}
        {link && <p className={styles.note}>{t("settings.remote.scan")}</p>}
        {addresses && addresses.length > 1 && (
          <Field label={t("settings.remote.address")}>
            <Select
              aria-label={t("settings.remote.address")}
              options={addresses.map((ip) => ({ label: ip, value: ip }))}
              value={host}
              onChange={setPicked}
            />
          </Field>
        )}
        {link && (
          <Field label={t("settings.remote.link")}>
            <CopyField value={link} title={t("settings.remote.copyLink")} />
          </Field>
        )}
        <Field
          label={t("settings.remote.key")}
          hint={t("settings.remote.keyHint")}
        >
          <CopyField value={remote.key} title={t("settings.remote.copyKey")} />
        </Field>
        <Field
          label={t("settings.remote.mcp")}
          hint={t("settings.remote.mcpHint")}
        >
          <CopyField value={MCP_URL} title={t("settings.remote.copyMcp")} />
        </Field>
        <Field label={t("settings.remote.mcpCommand")}>
          <CopyField
            value={mcpCommand(remote.key)}
            title={t("settings.remote.copyCommand")}
          />
        </Field>
        <p className={styles.note}>{t("settings.remote.mcpNote")}</p>
        <div>
          <Btn onClick={() => setShown(false)}>{t("settings.remote.hide")}</Btn>
        </div>
      </div>
    </div>
  ) : (
    <div>
      <Btn onClick={() => setShown(true)}>{t("settings.remote.show")}</Btn>
    </div>
  );

  return (
    <Section
      icon={<LuSmartphone />}
      title={t("settings.remote.title")}
      description={t("settings.remote.description")}
      actions={
        <Btn
          variant="icon"
          title={t("settings.remote.newKey")}
          onClick={() => window.api.emit(APP_EVENTS.NEW_REMOTE_KEY)}
        >
          <FiRefreshCw size={18} />
        </Btn>
      }
    >
      <Check
        label={t("settings.remote.label")}
        checked={remote.enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {!serverEnabled && (
        <p className={styles.note}>{t("settings.remote.serverOff")}</p>
      )}
      {/* The key comes with main's echo of the settings */}
      {remote.enabled && remote.key && details}
    </Section>
  );
}
