import { Permissions } from "@/common/schemas";
import { Updater } from "@/hooks/useImmerState";
import { useT } from "@/ui/i18n";
import { Check, ListTextarea, NumberInput } from "../Elements";
import { Field, Section } from "../Page";
import styles from "./permissionssection.module.css";

interface Props {
  permissions: Permissions;
  update: Updater<Permissions>;
  // Feature name shown in the description, in the window's language
  feature: string;
}

const ROLES = [
  { key: "all", label: "components.permissions.all" },
  { key: "followers", label: "components.permissions.followers" },
  { key: "superfans", label: "components.permissions.superfans" },
  { key: "moderators", label: "components.permissions.moderators" },
] as const;

export function PermissionsSection({ permissions, update, feature }: Props) {
  const t = useT();
  return (
    <Section
      title={t("components.permissions.title")}
      description={t("components.permissions.description", { feature })}
    >
      <div className={styles.grid}>
        {ROLES.map(({ key, label }) => (
          <Check
            key={key}
            label={t(label)}
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
          checked={permissions.level.enabled}
          onChange={(e) =>
            update((p) => {
              p.level.enabled = e.target.checked;
            })
          }
        />
        <NumberInput
          min={0}
          className={styles.level}
          value={permissions.level.value}
          disabled={!permissions.level.enabled}
          // Only CSS hides it while off, so keep it from screen readers too
          tabIndex={permissions.level.enabled ? undefined : -1}
          aria-hidden={!permissions.level.enabled || undefined}
          onChange={(level) =>
            update((p) => {
              p.level.value = level;
            })
          }
        />
      </div>

      <Check
        label={t("components.permissions.list")}
        checked={permissions.list.enabled}
        onChange={(e) =>
          update((p) => {
            p.list.enabled = e.target.checked;
          })
        }
      />

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
