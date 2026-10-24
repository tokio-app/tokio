import { APP_EVENTS, APP_EVENTS_RESPONSE, GamesData } from "@/common/types";
import { CopyField, Section, Toggle } from "@/components";
import { cx } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import homeStyles from "@/pages/Home/home.module.css";
import { useState } from "react";
import styles from "../games.module.css";
import { connectCommand, statusText } from "../helper";

const SETUP = [
  "In Settings → General → Network settings, turn on Enable WebSockets.",
  "Open a world with cheats on.",
  "Paste the command in the chat.",
];

type Props = {
  games: GamesData;
  onToggle: (enabled: boolean) => void;
};

export function MinecraftSection({ games, onToggle }: Props) {
  const { settings } = games;
  const status = games.status.minecraft;
  const { state } = status;
  // This PC's addresses, for a game on another device
  const [addresses, setAddresses] = useState<string[]>([]);
  const command = connectCommand("localhost");

  useIpcRequest(APP_EVENTS.GET_NETWORK_ADDRESSES);
  useIpcListener(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, (res) => {
    if (res) setAddresses(res.addresses);
  });

  return (
    <Section
      title="Minecraft"
      description="Bedrock Edition connects from its chat."
    >
      <div className={styles.panel}>
        <div className={styles.status_row}>
          <Toggle
            aria-label="Listen for Minecraft"
            checked={settings.minecraft.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <p
            className={cx(
              homeStyles.status,
              state === "connected" && homeStyles.status_live,
              state === "error" && styles.status_error,
            )}
          >
            <span
              className={cx(
                homeStyles.dot,
                state === "connected" && homeStyles.dot_on,
                state === "error" && styles.dot_error,
              )}
            />
            {statusText(status)}
          </p>
        </div>

        {state !== "connected" && (
          <div className={styles.setup}>
            <ol className={styles.setup_steps}>
              {SETUP.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className={styles.device}>
              <span className={styles.device_label}>From this device</span>
              <CopyField
                code
                value={command}
                title="Copy the command"
                display={
                  <>
                    {command}
                    {state === "waiting" && (
                      <span className={styles.caret} aria-hidden />
                    )}
                  </>
                }
              />
            </div>
            {addresses.length > 0 && (
              <div className={styles.device}>
                <span className={styles.device_label}>From another device</span>
                {addresses.map((ip) => (
                  <CopyField
                    key={ip}
                    code
                    value={connectCommand(ip)}
                    title="Copy the command"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
