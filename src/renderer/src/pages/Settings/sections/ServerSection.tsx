import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { SERVER_PORT } from "@/common/util";
import { Check, CopyUrl, Field, Section } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { FiMonitor } from "react-icons/fi";
import styles from "../settings.module.css";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function ServerSection({ enabled, onChange }: Props) {
  // This PC's addresses, once main answers
  const [addresses, setAddresses] = useState<string[] | null>(null);

  useIpcRequest(APP_EVENTS.GET_NETWORK_ADDRESSES);
  useIpcListener(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, (res) => {
    if (res) setAddresses(res.addresses);
  });

  return (
    <Section
      icon={<FiMonitor />}
      title="Overlay Server"
      description="Serves your overlays to your streaming app."
    >
      <Check
        label="Enable Server"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {addresses && (
        <Field label="Network address" hint="(for OBS on another computer)">
          {addresses.length === 0 ? (
            <p className={styles.library_meta}>No network address found.</p>
          ) : (
            addresses.map((ip) => (
              <CopyUrl key={ip} url={`http://${ip}:${SERVER_PORT}/`} />
            ))
          )}
        </Field>
      )}
    </Section>
  );
}
