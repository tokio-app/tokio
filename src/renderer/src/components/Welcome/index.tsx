import { EntityMetadata, ProfileSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Platform,
  PLATFORMS,
} from "@/common/types";
import { EULER_SIGNUP_URL, PLATFORM_LABELS } from "@/common/util";
import { cx } from "@/helper/cx";
import { PLATFORM_ICONS } from "@/helper/platforms";
import { useIpcListener } from "@/hooks";
import { rich, useT } from "@/ui/i18n";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Btn, Input } from "../Elements";
import elements from "../Elements/elements.module.css";
import { Modal } from "../Modal";
import { Field } from "../Page";
import page from "../Page/page.module.css";
import { TwitchSignIn } from "../TwitchSignIn";
import styles from "./welcome.module.css";

// What main needs from the first GET_SETTINGS reply
type Loaded = { profile: EntityMetadata; provider: string };

// Shortest name main takes for a profile
const MIN_NAME = ProfileSchema.shape.name.minLength ?? 1;

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
 * changed; Skip, Escape and the close button send nothing, and ask first
 * when something was typed.
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
  const [leaving, setLeaving] = useState(false);
  const platformLabel = useId();

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
  // What Skip would drop: a channel, the key or a new name
  const typed =
    Object.values(channels).some((c) => c.trim()) ||
    key.trim() !== "" ||
    (!!loaded && trimmed !== loaded.profile.name);
  const skip = () => (typed ? setLeaving(true) : onClose());

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
    <>
      {/* A form, so Enter in a field saves as Save does: a disabled Save
          stops it too */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Modal
          title={t("components.welcome.title")}
          description={t("components.welcome.description")}
          onClose={skip}
          closeButton
          maxWidth="500px"
          // Its height changes with the platform: from the top, only its foot
          // moves, never the platforms under the pointer
          top
          footer={
            <>
              <Btn onClick={skip}>{t("components.welcome.skip")}</Btn>
              <Btn
                ref={saveRef}
                type="submit"
                variant="accent"
                disabled={!ready}
              >
                {t("common.save")}
              </Btn>
            </>
          }
        >
          {/* A choice of one: native radios, whose arrow keys pick, drawn as
              the pill switch's segments */}
          <Field>
            <span id={platformLabel} className={page.field_label}>
              {t("components.welcome.platform")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={platformLabel}
              className={cx(
                elements.tabs,
                elements.tabs_pill,
                styles.platforms,
              )}
            >
              {PLATFORMS.map((p) => {
                const Icon = PLATFORM_ICONS[p];
                return (
                  <label
                    key={p}
                    className={cx(
                      elements.tab,
                      p === platform && elements.tab_active,
                      styles.platform,
                    )}
                  >
                    <input
                      type="radio"
                      name="welcome-platform"
                      className={styles.radio}
                      checked={p === platform}
                      onChange={() => setPlatform(p)}
                    />
                    <Icon size={16} aria-hidden />
                    {PLATFORM_LABELS[p]}
                  </label>
                );
              })}
            </div>
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
      </form>

      {/* Outside the form: its buttons and Enter are its own */}
      {leaving && (
        <Modal
          title={t("components.welcome.skipTitle")}
          description={t("components.welcome.skipDescription")}
          confirmText={t("components.welcome.skip")}
          onClose={() => setLeaving(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}
