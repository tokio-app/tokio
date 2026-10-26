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

  return (
    <Section title="Format" description="Which chat messages get read.">
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
            label: "Read All Comments",
            description:
              "Every single message in chat will be processed by TTS.",
          },
          {
            value: "dot",
            label: "Dot Prefix ( . )",
            description: "Only messages starting with a period will be read.",
          },
          {
            value: "slash",
            label: "Slash Prefix ( / )",
            description:
              "Only messages starting with a forward slash will be read.",
          },
          {
            value: "custom",
            label: (
              <>
                Custom Command
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
            description:
              "Only messages starting with this phrase, in any case, will be read, without the phrase.",
          },
        ]}
      />

      <Field label="Message Template">
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
        label="Remove Emojis"
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
