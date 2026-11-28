import { Profile } from "@/common/schemas";
import { MODE_VALUES } from "@/common/util/tts";
import {
  Check,
  Field,
  Input,
  RadioGroup,
  Section,
  VariableList,
} from "@/components";
import { usePlatforms } from "@/context/platforms";
import { languageName } from "@/helper/voices";
import { shownVariables, Updater, useTranslationLanguage } from "@/hooks";
import { rich, useLanguage, useT } from "@/ui/i18n";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import styles from "../tts.module.css";

type Format = Profile["tts"]["format"];

// The ones TTSService fills in the template, see _parseText
const TEMPLATE_VARIABLES = ["username", "handle", "comment", "translation"];

interface Props {
  format: Format;
  update: Updater<Format>;
}

export function FormatSection({ format, update }: Props) {
  const custom = format.trigger.mode === "custom";
  const templateRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const lang = useLanguage();
  const translating = useTranslationLanguage();
  const platforms = usePlatforms();
  const variables = shownVariables(TEMPLATE_VARIABLES, translating, platforms);

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
          },
          {
            value: "dot",
            label: t("tts.format.dot"),
          },
          {
            value: "slash",
            label: t("tts.format.slash"),
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
          variables={variables}
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

      {/* Only TikTok's chat is translated */}
      {platforms.includes("tiktok") && (
        <div className={styles.check_group}>
          <Check
            label={t("tts.format.translate")}
            checked={format.translate}
            disabled={translating === ""}
            onChange={(e) =>
              update((f) => {
                f.translate = e.target.checked;
              })
            }
          />
          <p className={styles.check_hint}>
            {translating === ""
              ? rich(t("tts.format.translateOff"), {
                  link: (text) => <Link to="/settings">{text}</Link>,
                })
              : t("tts.format.translateHint", {
                  language: languageName(translating, lang),
                })}
          </p>
        </div>
      )}
    </Section>
  );
}
