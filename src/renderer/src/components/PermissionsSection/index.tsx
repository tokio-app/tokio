import { MessageKey } from "@/common/i18n";
import { Permissions, PlatformPermissions } from "@/common/schemas";
import { Platform, PLATFORMS } from "@/common/types";
import { defaultPlatformPermissions, PLATFORM_LABELS } from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { PLATFORM_ICONS } from "@/helper";
import { cx } from "@/helper/cx";
import { Updater } from "@/hooks/useImmerState";
import { useT } from "@/ui/i18n";
import { useId, useState } from "react";
import { Check, ListTextarea, NumberInput, tabPanel, Tabs } from "../Elements";
import { Field, Section } from "../Page";
import styles from "./permissionssection.module.css";

interface Props {
  permissions: Permissions;
  update: Updater<Permissions>;
  // What the rules are for, in the window's language and inside a sentence:
  // "song requests", "TTS"
  feature: string;
}

const TIKTOK_ROLES = [
  { key: "all", label: "components.permissions.all" },
  { key: "followers", label: "components.permissions.followers" },
  { key: "superfans", label: "components.permissions.superfans" },
  { key: "moderators", label: "components.permissions.moderators" },
] as const;

type Role = { key: keyof PlatformPermissions; label: MessageKey };

// What the other platforms' chat says, from its badges: subscribers or
// members, moderators, and Twitch's and Kick's VIPs. Never who follows.
const SUBSCRIBERS: Role[] = [
  { key: "all", label: "components.permissions.all" },
  { key: "superfans", label: "components.permissions.subscribers" },
  { key: "moderators", label: "components.permissions.moderators" },
  { key: "vips", label: "components.permissions.vips" },
];
const PLATFORM_ROLES: Record<Exclude<Platform, "tiktok">, Role[]> = {
  twitch: SUBSCRIBERS,
  youtube: [
    { key: "all", label: "components.permissions.all" },
    { key: "superfans", label: "components.permissions.members" },
    { key: "moderators", label: "components.permissions.moderators" },
  ],
  kick: SUBSCRIBERS,
};

/**
 * Who can use TTS or music requests: a tab of rules for each of the
 * profile's platforms (TikTok's are the saved base fields, the others' in
 * platforms), then the allow and block lists, which every platform shares.
 */
export function PermissionsSection({ permissions, update, feature }: Props) {
  const t = useT();
  const panelId = useId();
  const profilePlatforms = usePlatforms();
  const tabs = PLATFORMS.filter((p) => profilePlatforms.includes(p));
  const [picked, setPicked] = useState<Platform>();
  const tab = (picked && tabs.includes(picked) ? picked : tabs[0]) ?? "tiktok";
  const several = tabs.length > 1;

  // Allow everyone passes anyone, whatever the roles say
  let rules;
  if (tab === "tiktok") {
    const everyone = permissions.all;
    const levelShown = permissions.level.enabled;
    rules = (
      <div className={styles.grid}>
        {TIKTOK_ROLES.map(({ key, label }) => (
          <Check
            key={key}
            label={t(label)}
            disabled={key !== "all" && everyone}
            checked={permissions[key]}
            onChange={(e) =>
              update((p) => {
                p[key] = e.target.checked;
              })
            }
          />
        ))}

        <Check
          label={t("components.permissions.level")}
          disabled={everyone}
          checked={permissions.level.enabled}
          onChange={(e) =>
            update((p) => {
              p.level.enabled = e.target.checked;
            })
          }
        />
        <NumberInput
          min={0}
          className={cx(styles.level, !levelShown && styles.level_off)}
          value={permissions.level.value}
          disabled={!levelShown || everyone}
          // Only CSS hides it while off, so keep it from screen readers too
          tabIndex={levelShown ? undefined : -1}
          aria-hidden={!levelShown || undefined}
          onChange={(level) =>
            update((p) => {
              p.level.value = level;
            })
          }
        />
      </div>
    );
  } else {
    const saved = permissions.platforms[tab] ?? defaultPlatformPermissions;
    rules = (
      <div className={styles.grid}>
        {PLATFORM_ROLES[tab].map(({ key, label }) => (
          <Check
            key={key}
            label={t(label)}
            disabled={key !== "all" && saved.all}
            checked={saved[key]}
            onChange={(e) =>
              update((p) => {
                const own = (p.platforms[tab] ??= {
                  ...defaultPlatformPermissions,
                });
                own[key] = e.target.checked;
              })
            }
          />
        ))}
      </div>
    );
  }

  return (
    <Section
      title={t("components.permissions.title")}
      description={t("components.permissions.description", { feature })}
    >
      {several && (
        <Tabs
          className={styles.tabs}
          label={t("components.permissions.platform")}
          tabs={tabs.map((value) => {
            const Icon = PLATFORM_ICONS[value];
            return {
              value,
              icon: <Icon aria-hidden />,
              label: PLATFORM_LABELS[value],
            };
          })}
          value={tab}
          onChange={setPicked}
          panelId={panelId}
        />
      )}
      <div
        {...(several ? tabPanel(panelId, tab) : {})}
        className={styles.rules}
      >
        {rules}
        {/* The roles and the level pass with any one of them, see
            hasPermission */}
        <p className={styles.rule}>
          {t(
            tab === "tiktok"
              ? "components.permissions.ruleLevel"
              : "components.permissions.rule",
            { feature },
          )}
        </p>
      </div>

      <div className={styles.lists}>
        <Check
          label={t("components.permissions.list")}
          checked={permissions.list.enabled}
          onChange={(e) =>
            update((p) => {
              p.list.enabled = e.target.checked;
            })
          }
        />
        {several && (
          <p className={styles.note}>
            {t("components.permissions.listsEverywhere")}
          </p>
        )}
      </div>

      {permissions.list.enabled && (
        <>
          <Field
            label={t("components.permissions.allowList")}
            hint={t("components.permissions.listHint")}
          >
            <ListTextarea
              placeholder={t("components.permissions.listPlaceholder")}
              value={permissions.list.white}
              onChange={(white) =>
                update((p) => {
                  p.list.white = white;
                })
              }
            />
            <p className={styles.rule}>
              {t("components.permissions.allowListRule", { feature })}
            </p>
          </Field>
          <Field
            label={t("components.permissions.blockList")}
            hint={t("components.permissions.listHint")}
          >
            <ListTextarea
              placeholder={t("components.permissions.listPlaceholder")}
              value={permissions.list.black}
              onChange={(black) =>
                update((p) => {
                  p.list.black = black;
                })
              }
            />
          </Field>
        </>
      )}
    </Section>
  );
}
