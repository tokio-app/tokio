import { Profile } from "@/common/schemas";
import { Field, FormGrid, ListTextarea, NumberInput } from "@/components";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";

type Protection = Profile["tts"]["protection"];

interface Props {
  protection: Protection;
  update: Updater<Protection>;
}

/**
 * TTS only protection settings, shown under the shared ones.
 */
export function ProtectionFields({ protection, update }: Props) {
  const t = useT();
  return (
    <>
      <FormGrid>
        <Field
          label={t("tts.protection.commentLength")}
          hint={t("tts.protection.characters")}
        >
          <NumberInput
            min={1}
            integer
            value={protection.comment_length}
            onChange={(length) =>
              update((p) => {
                p.comment_length = length;
              })
            }
          />
        </Field>
      </FormGrid>

      <Field
        label={t("tts.protection.banned")}
        hint={t("tts.protection.commaSeparated")}
      >
        <ListTextarea
          placeholder={t("tts.protection.bannedPlaceholder")}
          value={protection.banned}
          onChange={(banned) =>
            update((p) => {
              p.banned = banned;
            })
          }
        />
      </Field>
    </>
  );
}
