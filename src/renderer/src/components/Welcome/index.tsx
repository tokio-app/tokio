import { EntityMetadata } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Platform,
  PLATFORMS,
} from "@/common/types";
import { EULER_SIGNUP_URL, PLATFORM_LABELS } from "@/common/util";
import { PLATFORM_ICONS } from "@/helper/platforms";
import { useIpcListener } from "@/hooks";
import { rich, useT } from "@/ui/i18n";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Btn, Input, Tabs } from "../Elements";
import { Modal } from "../Modal";
import { Field } from "../Page";
import { TwitchSignIn } from "../TwitchSignIn";
import styles from "./welcome.module.css";

// What main needs from the first GET_SETTINGS reply
type Loaded = { profile: EntityMetadata; provider: string };

// Shortest name main takes for a profile
const MIN_NAME = 3;

// The field each platform asks for. Twitch's is the account.
const FIELDS = {
  tiktok: {
    label: "components.welcome.username",
    placeholder: "home.dashboard.username",
  },
  youtube: {
    label: "components.welcome.youtube",
    placeholder: "home.dashboard.youtubeChannel",
  },
  kick: {
    label: "components.welcome.kick",
    placeholder: "home.dashboard.kickChannel",
  },
} as const;

/**
 * The first start's questions: the platform, its channel (TikTok's Euler key
 * too, or Twitch's sign-in) and the profile's name. Save sends only what was
 * changed; Skip, Escape and the close button send nothing.
 */
export function Welcome({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [platform, setPlatform] = useState<Platform>("tiktok");
  // The channel typed for each platform, kept while another is picked
  const [channels, setChannels] = useState<Partial<Record<Platform, string>>>(
    {},
  );
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  // Until Layout's GET_SETTINGS reply, which names the profile and provider
  const [loaded, setLoaded] = useState<Loaded>();
  const saveRef = useRef<HTMLButtonElement>(null);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (!res?.success) return;
    const { settings } = res.data!;
    setLogin(settings.accounts.twitch.login);
    // Later replies would write over the name being typed
    if (loaded) return;
    setLoaded({
      profile: settings.activeProfile,
      provider: settings.activeConnProvider.name,
    });
    setName(settings.activeProfile.name);
  });

  useIpcListener(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, (res) => {
    if (!res?.success) return;
    // The sign-in's modal leaves with the button that opened it, and
    // Chromium drops the focus on <body>, where Escape no longer reaches us
    flushSync(() => setLogin(res.login));
    if (res.login) saveRef.current?.focus();
  });

  const trimmed = name.trim();
  const ready = !!loaded && trimmed.length >= MIN_NAME;

  const save = () => {
    if (!loaded || !ready) return;
    const tiktok = platform === "tiktok";
    const channel = channels[platform]?.trim() ?? "";
    const typedKey = tiktok ? key.trim() : "";
    if (!tiktok) {
      window.api.emit(APP_EVENTS.SET_PLATFORMS, { platforms: [platform] });
    }
    if (channel) {
      window.api.emit(
        APP_EVENTS.SET_CHANNELS,
        tiktok ? { username: channel } : { channels: { [platform]: channel } },
      );
    }
    if (typedKey) {
      window.api.emit(APP_EVENTS.SET_PROVIDER, {
        name: loaded.provider,
        key: typedKey,
        type: "connector",
      });
    }
    if (trimmed !== loaded.profile.name) {
      window.api.emit(APP_EVENTS.RENAME_PROFILE, {
        file: loaded.profile.file,
        name: trimmed,
      });
    }
    onClose();
  };

  // A platform's own fields: its channel, or Twitch's account, and TikTok's
  // Euler key
  const fieldsOf = (p: Platform) => {
    if (p === "twitch") {
      return (
        <Field label={t("components.welcome.twitch")}>
          {login ? (
            <span className={styles.account}>
              {t("settings.twitch.signedIn", { login })}
            </span>
          ) : (
            <TwitchSignIn />
          )}
        </Field>
      );
    }
    const field = FIELDS[p];
    return (
      <>
        <Field label={t(field.label)}>
          <Input
            aria-label={t(field.label)}
            placeholder={t(field.placeholder)}
            value={channels[p] ?? ""}
            onChange={(e) => {
              const text = e.target.value;
              setChannels((now) => ({ ...now, [p]: text }));
            }}
          />
        </Field>
        {p === "tiktok" && (
          <Field
            label={t("components.welcome.key")}
            hint={t("components.welcome.optional")}
          >
            <Input
              type="password"
              aria-label={t("components.welcome.key")}
              placeholder={t("settings.providers.keyPlaceholder")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <p className={styles.note}>
              {rich(t("components.welcome.keyNote"), {
                link: (text) => (
                  <a
                    className={styles.link}
                    href={EULER_SIGNUP_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {text}
                  </a>
                ),
              })}
            </p>
          </Field>
        )}
      </>
    );
  };

  return (
    <Modal
      title={t("components.welcome.title")}
      description={t("components.welcome.description")}
      onClose={onClose}
      closeButton
      maxWidth="500px"
      // Its height changes with the platform: from the top, only its foot
      // moves, never the tabs under the pointer
      top
      footer={
        <>
          <Btn onClick={onClose}>{t("components.welcome.skip")}</Btn>
          <Btn ref={saveRef} variant="accent" disabled={!ready} onClick={save}>
            {t("common.save")}
          </Btn>
        </>
      }
    >
      <Field label={t("components.welcome.platform")}>
        <Tabs
          variant="pill"
          className={styles.platforms}
          label={t("components.welcome.platform")}
          value={platform}
          onChange={setPlatform}
          tabs={PLATFORMS.map((p) => {
            const Icon = PLATFORM_ICONS[p];
            return {
              value: p,
              label: PLATFORM_LABELS[p],
              icon: <Icon size={16} aria-hidden />,
            };
          })}
        />
      </Field>

      {fieldsOf(platform)}

      <Field label={t("components.welcome.profileName")}>
        <Input
          aria-label={t("components.welcome.profileName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className={styles.note}>{t("components.welcome.profileNote")}</p>
      </Field>
    </Modal>
  );
}
