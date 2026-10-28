import { AppSettings, Profile } from "@/common/schemas";
import { Section, Toggle } from "@/components";
import { cx } from "@/helper";
import { useLanguage, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { FiChevronRight } from "react-icons/fi";
import { alertsStatus, serverStatus } from "../helper";
import styles from "../home.module.css";

type Features = AppSettings["activeFeatures"];

const FEATURES = [
  { key: "tts", label: "nav.tts", to: "/tts" },
  { key: "music", label: "nav.music", to: "/music" },
  { key: "alerts", label: "nav.alerts", to: "/alerts" },
] as const;

interface Props {
  features: Features;
  profile: Profile;
  musicConnected: boolean;
  server: { enabled: boolean; overlays: number };
  onChange: (feature: keyof Features, enabled: boolean) => void;
}

export function FeaturesSection({
  features,
  profile,
  musicConnected,
  server,
  onChange,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const provider = profile.music.provider.name;
  // What each feature does once it's on. Music can't play without its
  // provider, so that's a warning while it's on.
  const status: Record<keyof Features, { text: string; warn?: boolean }> = {
    tts: { text: t("home.features.voice", { voice: profile.tts.voice.name }) },
    music: {
      text: t(
        musicConnected
          ? "home.features.musicConnected"
          : "home.features.musicDisconnected",
        { provider },
      ),
      warn: features.music && !musicConnected,
    },
    alerts: { text: alertsStatus(profile.alerts.items, language) },
  };
  const serverPage = server.enabled
    ? ({ to: "/overlays", label: "nav.overlays" } as const)
    : ({ to: "/settings", label: "nav.settings" } as const);

  return (
    <Section title={t("home.features.title")}>
      <ul className={styles.features}>
        {FEATURES.map(({ key, label, to }) => (
          <li key={key} className={styles.feature}>
            <Toggle
              label={t(label)}
              checked={features[key]}
              onChange={(e) => onChange(key, e.target.checked)}
            />
            <span
              className={cx(
                styles.feature_status,
                status[key].warn && styles.feature_warn,
              )}
              title={status[key].text}
            >
              {status[key].text}
            </span>
            <Link
              to={to}
              className={styles.feature_link}
              aria-label={t("home.features.goTo", { page: t(label) })}
            >
              <FiChevronRight size={18} />
            </Link>
          </li>
        ))}

        <li className={styles.feature}>
          <span className={styles.feature_name}>
            <span className={styles.feature_dot}>
              <span
                className={cx(styles.dot, server.enabled && styles.dot_on)}
              />
            </span>
            {t("nav.overlays")}
          </span>
          <span className={styles.feature_status}>
            {serverStatus(server.enabled, server.overlays, language)}
          </span>
          <Link
            to={serverPage.to}
            className={styles.feature_link}
            aria-label={t("home.features.goTo", { page: t(serverPage.label) })}
          >
            <FiChevronRight size={18} />
          </Link>
        </li>
      </ul>
    </Section>
  );
}
