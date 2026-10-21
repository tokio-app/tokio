import { Profile } from "@/common/schemas";
import { Btn, Field, Input, Section, Tabs } from "@/components";
import { cx } from "@/helper";
import { Updater } from "@/hooks";
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
  const isSpotify = provider.name === "Spotify";
  const missingKey = isSpotify && provider.key === "";

  return (
    <Section title="Provider" description="Where requested songs play.">
      <div className={styles.status}>
        Status:{" "}
        <span className={cx(connected && styles.status_connected)}>
          {connected ? "Connected" : "Disconnected"}
        </span>
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
          isSpotify && styles.expandable_open,
          connected && styles.locked,
        )}
        // Only CSS collapses it
        aria-hidden={!isSpotify || undefined}
      >
        <div className={styles.expandable_content}>
          <Field label="Spotify Client ID">
            <Input
              type="password"
              tabIndex={isSpotify ? undefined : -1}
              className={styles.key_input}
              placeholder="Enter your Spotify Client ID..."
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
          {connected ? "Disconnect" : "Connect"}
        </Btn>
      </div>
    </Section>
  );
}
