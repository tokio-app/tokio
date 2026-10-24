import { MinecraftEdition } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  GamesData,
  MINECRAFT_EDITION_NAMES,
} from "@/common/types";
import { MINECRAFT_MOD_DOCS_URL } from "@/common/util";
import { CopyField, Section, Toggle } from "@/components";
import { cx } from "@/helper";
import { useIpcListener, useIpcRequest } from "@/hooks";
import homeStyles from "@/pages/Home/home.module.css";
import { ReactNode, useState } from "react";
import styles from "../games.module.css";
import { connectCommand, EDITIONS, statusText } from "../helper";

// Each edition's way in, side by side until a game connects
const SETUP: Record<MinecraftEdition, ReactNode[]> = {
  bedrock: [
    "In Settings → General → Network settings, turn on Enable WebSockets.",
    "Open a world with cheats on.",
    "Paste the command in the chat.",
  ],
  java: [
    <>
      Install Fabric Loader and Fabric API for Minecraft 26.3, then the Tokio
      mod.{" "}
      <a
        className={styles.link}
        href={MINECRAFT_MOD_DOCS_URL}
        target="_blank"
        rel="noreferrer"
      >
        See how
      </a>
    </>,
    "Open a world. Cheats can stay off.",
    "Paste the command in the chat.",
  ],
};

type Props = {
  games: GamesData;
  onToggle: (enabled: boolean) => void;
};

export function MinecraftSection({ games, onToggle }: Props) {
  const { settings } = games;
  const status = games.status.minecraft;
  const { state } = status;
  // This PC's addresses, null until main answers. Tokio listens on all of
  // them, so one command works from this PC and from another device.
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const hosts = addresses?.length ? addresses : ["localhost"];

  useIpcRequest(APP_EVENTS.GET_NETWORK_ADDRESSES);
  useIpcListener(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, (res) => {
    if (res) setAddresses(res.addresses);
  });

  return (
    <Section
      title="Minecraft"
      description="Bedrock and Java connect from their chat."
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
            {EDITIONS.map(({ value: edition, label }) => (
              <div key={edition} className={styles.edition}>
                <h3 className={styles.edition_name}>
                  {MINECRAFT_EDITION_NAMES[edition]}
                </h3>
                <ol className={styles.setup_steps}>
                  {SETUP[edition].map((step, i) => (
                    <li key={i}>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {addresses && (
                  <div className={styles.commands}>
                    {hosts.map((host, i) => (
                      <CopyField
                        key={host}
                        code
                        value={connectCommand(host, edition)}
                        title={`Copy the ${label} command`}
                        display={
                          <>
                            {connectCommand(host, edition)}
                            {i === 0 && state === "waiting" && (
                              <span className={styles.caret} aria-hidden />
                            )}
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
