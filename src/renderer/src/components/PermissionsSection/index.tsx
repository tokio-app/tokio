import { Permissions } from "@/common/schemas";
import { Updater } from "@/hooks/useImmerState";
import { Check, ListTextarea, NumberInput } from "../Elements";
import { Field, Section } from "../Page";
import styles from "./permissionssection.module.css";

interface Props {
  permissions: Permissions;
  update: Updater<Permissions>;
  // Feature name shown in the description
  feature: "TTS" | "Music";
}

const ROLES = [
  { key: "all", label: "Allow Everyone" },
  { key: "followers", label: "Followers Only" },
  { key: "superfans", label: "Superfans Only" },
  { key: "moderators", label: "Moderators Only" },
] as const;

export function PermissionsSection({ permissions, update, feature }: Props) {
  return (
    <Section
      title="Permissions"
      description={`Control exactly who has permission to use the ${feature} system.`}
    >
      <div className={styles.grid}>
        {ROLES.map(({ key, label }) => (
          <Check
            key={key}
            label={label}
            checked={permissions[key]}
            onChange={(e) =>
              update((p) => {
                p[key] = e.target.checked;
              })
            }
          />
        ))}

        <Check
          label="Minimum Fan Level"
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
          onChange={(level) =>
            update((p) => {
              p.level.value = level;
            })
          }
        />
      </div>

      <Check
        label="Enable Whitelist / Blacklist"
        checked={permissions.list.enabled}
        onChange={(e) =>
          update((p) => {
            p.list.enabled = e.target.checked;
          })
        }
      />

      {permissions.list.enabled && (
        <>
          <Field label="Whitelist" hint="(comma separated)">
            <ListTextarea
              placeholder="@handle1, @handle2, @handle3, ..."
              value={permissions.list.white}
              onChange={(white) =>
                update((p) => {
                  p.list.white = white;
                })
              }
            />
          </Field>
          <Field label="Blacklist" hint="(comma separated)">
            <ListTextarea
              placeholder="@handle1, @handle2, @handle3, ..."
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
