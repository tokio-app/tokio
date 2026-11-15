import { Profile } from "@/common/schemas";
import { Btn, Check, Field, Input, Modal, Section, Tabs } from "@/components";
import { cx } from "@/helper";
import { Updater } from "@/hooks";
import { rich, useT } from "@/ui/i18n";
import { useState } from "react";
import { FaSpotify, FaYoutube } from "react-icons/fa";
import styles from "../music.module.css";

type Provider = Profile["music"]["provider"];

const PROVIDER_TABS: {
  value: Provider["name"];
  label: string;
  icon: React.ReactNode;
  accent: string;
}[] = [
  {
    value: "YouTube",
    label: "YouTube",
    icon: <FaYoutube size={20} />,
    accent: "#ff0000",
  },
  {
    value: "Spotify",
    label: "Spotify",
    icon: <FaSpotify size={20} />,
    accent: "#1db954",
  },
];

interface Props {
  provider: Provider;
  update: Updater<Provider>;
  connected: boolean;
  loading: boolean;
  onConnect: () => void;
}

export function ProviderSection({
  provider,
  update,
  connected,
  loading,
  onConnect,
}: Props) {
  const t = useT();
  // Turning ad blocking on asks first: it breaks YouTube's terms
  const [askingAds, setAskingAds] = useState(false);
  const isSpotify = provider.name === "Spotify";
  const missingKey = isSpotify && provider.key === "";
  const setBlockAds = (blockAds: boolean) =>
    update((p) => {
      p.block_ads = blockAds;
    });

  return (
    <Section
      title={t("music.provider.title")}
      description={t("music.provider.description")}
    >
      {askingAds && (
        <Modal
          title={t("music.provider.blockAdsTitle")}
          description={t("music.provider.blockAdsDescription")}
          confirmText={t("music.provider.blockAds")}
          onClose={() => setAskingAds(false)}
          onConfirm={() => {
            setBlockAds(true);
            setAskingAds(false);
          }}
        />
      )}

      <div className={styles.status}>
        {rich(t("music.provider.status"), {
          status: (
            <span className={cx(connected && styles.status_connected)}>
              {t(
                connected ? "common.connected" : "music.provider.disconnected",
              )}
            </span>
          ),
        })}
      </div>

      <Tabs
        variant="pill"
        tabs={PROVIDER_TABS}
        value={provider.name}
        disabled={connected}
        onChange={(name) =>
          update((p) => {
            p.name = name;
          })
        }
      />

      <div
        className={cx(
          styles.expandable,
          !isSpotify && styles.expandable_open,
          connected && styles.locked,
        )}
        // Only CSS collapses it
        aria-hidden={isSpotify || undefined}
      >
        <div className={styles.expandable_content}>
          <Check
            label={t("music.provider.blockAds")}
            tabIndex={isSpotify ? -1 : undefined}
            checked={provider.block_ads}
            disabled={connected}
            onChange={(e) => {
              if (e.target.checked) setAskingAds(true);
              else setBlockAds(false);
            }}
          />
        </div>
      </div>

      <div
        className={cx(
          styles.expandable,
          isSpotify && styles.expandable_open,
          connected && styles.locked,
        )}
        // Only CSS collapses it
        aria-hidden={!isSpotify || undefined}
      >
        <div className={styles.expandable_content}>
          <Field label={t("music.provider.spotifyKey")}>
            <Input
              type="password"
              tabIndex={isSpotify ? undefined : -1}
              className={styles.key_input}
              placeholder={t("music.provider.spotifyKeyPlaceholder")}
              value={provider.key}
              disabled={connected}
              onChange={(e) =>
                update((p) => {
                  p.key = e.target.value;
                })
              }
            />
          </Field>
        </div>
      </div>

      <div>
        <Btn
          variant={connected ? "default" : "accent"}
          className={styles.connect_btn}
          loading={loading}
          disabled={missingKey}
          onClick={onConnect}
        >
          {t(connected ? "common.disconnect" : "common.connect")}
        </Btn>
      </div>
    </Section>
  );
}
