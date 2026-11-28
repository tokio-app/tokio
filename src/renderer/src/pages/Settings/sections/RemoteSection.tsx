import { RemoteSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { getRemoteURL } from "@/common/util";
import {
  Btn,
  Check,
  CopyField,
  Field,
  Modal,
  QRCode,
  Section,
  Select,
} from "@/components";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiRefreshCw } from "react-icons/fi";
import { LuSmartphone } from "react-icons/lu";
import styles from "../settings.module.css";

interface Props {
  remote: RemoteSettings;
  // The phone reaches Tokio through the overlay server
  serverEnabled: boolean;
  // This PC's addresses, once main answers
  addresses: string[] | null;
  onChange: (enabled: boolean) => void;
}

export function RemoteSection({
  remote,
  serverEnabled,
  addresses,
  onChange,
}: Props) {
  const t = useT();
  const [picked, setPicked] = useState("");
  // Hidden until asked, as OBS hides stream keys: streamers show their screen
  const [shown, setShown] = useState(false);
  // A new key cuts off every phone, Stream Deck and assistant, so it asks
  const [asking, setAsking] = useState(false);

  const host = addresses?.includes(picked) ? picked : addresses?.[0];
  const link = host ? getRemoteURL(host, remote.key) : "";

  const details = shown && (
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
      </div>
    </div>
  );

  return (
    <Section
      icon={<LuSmartphone />}
      title={t("settings.remote.title")}
      description={t("settings.remote.description")}
      actions={
        remote.enabled && (
          <Btn
            variant="icon"
            title={t("settings.remote.newKey")}
            onClick={() => setAsking(true)}
          >
            <FiRefreshCw size={18} />
          </Btn>
        )
      }
    >
      {asking && (
        <Modal
          title={t("settings.remote.newKeyTitle")}
          description={t("settings.remote.newKeyDescription")}
          confirmText={t("settings.remote.newKeyConfirm")}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            window.api.emit(APP_EVENTS.NEW_REMOTE_KEY);
          }}
        />
      )}
      <Check
        label={t("settings.remote.label")}
        checked={remote.enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {!serverEnabled && (
        <p className={styles.note}>{t("settings.remote.serverOff")}</p>
      )}
      {/* The key comes with main's echo of the settings. One button whose
          text changes, so the focus stays on it. */}
      {remote.enabled && remote.key && (
        <>
          <div>
            <Btn onClick={() => setShown(!shown)}>
              {t(shown ? "settings.remote.hide" : "settings.remote.show")}
            </Btn>
          </div>
          {details}
        </>
      )}
    </Section>
  );
}
