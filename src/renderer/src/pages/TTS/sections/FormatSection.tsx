import { Profile } from "@/common/schemas";
import {
  Check,
  Field,
  Input,
  RadioGroup,
  Section,
  VariableList,
} from "@/components";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useRef } from "react";
import styles from "../tts.module.css";

type Format = Profile["tts"]["format"];
type Mode = Format["trigger"]["mode"];

// Prefix each mode starts with
const MODE_VALUES: Record<Mode, string> = {
  any: "",
  dot: ".",
  slash: "/",
  custom: "!tts",
};

// The ones TTSService fills in the template, see _parseText
const TEMPLATE_VARIABLES = ["username", "handle", "comment"];

interface Props {
  format: Format;
  update: Updater<Format>;
}

export function FormatSection({ format, update }: Props) {
  const custom = format.trigger.mode === "custom";
  const templateRef = useRef<HTMLInputElement>(null);
  const t = useT();

  return (
    <Section
      title={t("tts.format.title")}
      description={t("tts.format.description")}
    >
      <RadioGroup
        name="trigger"
        value={format.trigger.mode}
        onChange={(mode) =>
          update((f) => {
            f.trigger = { mode, value: MODE_VALUES[mode] };
          })
        }
        options={[
          {
            value: "any",
            label: t("tts.format.any"),
            description: t("tts.format.anyDescription"),
          },
          {
            value: "dot",
            label: t("tts.format.dot"),
            description: t("tts.format.dotDescription"),
          },
          {
            value: "slash",
            label: t("tts.format.slash"),
            description: t("tts.format.slashDescription"),
          },
          {
            value: "custom",
            label: (
              <>
                {t("tts.format.custom")}
                <Input
                  className={styles.trigger_input}
                  placeholder="!tts"
                  value={custom ? format.trigger.value : ""}
                  disabled={!custom}
                  onChange={(e) =>
                    update((f) => {
                      f.trigger.value = e.target.value;
                    })
                  }
                />
              </>
            ),
            description: t("tts.format.customDescription"),
          },
        ]}
      />

      <Field label={t("tts.format.template")}>
        <Input
          ref={templateRef}
          value={format.template}
          onChange={(e) =>
            update((f) => {
              f.template = e.target.value;
            })
          }
        />
        <VariableList
          variables={TEMPLATE_VARIABLES}
          inputRef={templateRef}
          value={format.template}
          onChange={(template) =>
            update((f) => {
              f.template = template;
            })
          }
        />
      </Field>

      <Check
        label={t("tts.format.removeEmojis")}
        checked={format.remove_emojis}
        onChange={(e) =>
          update((f) => {
            f.remove_emojis = e.target.checked;
          })
        }
      />
    </Section>
  );
}
