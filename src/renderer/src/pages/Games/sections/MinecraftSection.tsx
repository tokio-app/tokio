import { MessageKey } from "@/common/i18n";
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
import { rich, useLanguage, useT } from "@/ui/i18n";
import { ReactNode, useState } from "react";
import styles from "../games.module.css";
import { connectCommand, EDITIONS, statusText } from "../helper";

// Each edition's way in, side by side until a game connects
const SETUP: Record<MinecraftEdition, MessageKey[]> = {
  bedrock: [
    "games.minecraft.bedrock.websockets",
    "games.minecraft.bedrock.world",
    "games.minecraft.paste",
  ],
  java: [
    "games.minecraft.java.install",
    "games.minecraft.java.world",
    "games.minecraft.paste",
  ],
};

// Java's install step links to the mod's docs
const docsLink = (text: ReactNode) => (
  <a
    className={styles.link}
    href={MINECRAFT_MOD_DOCS_URL}
    target="_blank"
    rel="noreferrer"
  >
    {text}
  </a>
);

type Props = {
  games: GamesData;
  onToggle: (enabled: boolean) => void;
};

export function MinecraftSection({ games, onToggle }: Props) {
  const t = useT();
  const language = useLanguage();
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
    <Section title="Minecraft" description={t("games.minecraft.description")}>
      <div className={styles.panel}>
        <div className={styles.status_row}>
          <Toggle
            aria-label={t("games.minecraft.listen")}
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
            {statusText(status, language)}
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
                      <span>{rich(t(step), { link: docsLink })}</span>
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
                        title={t("games.minecraft.copyCommand", {
                          edition: label,
                        })}
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
