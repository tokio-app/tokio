import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  TranslationTest,
} from "@/common/types";
import { TRANSLATION_LANGUAGES } from "@/common/util";
import { Btn, Field, FormGrid, Input, Section, Select } from "@/components";
import { useIpcListener } from "@/hooks";
import { languageName } from "@/helper/voices";
import { ChatRow } from "@/pages/Home/sections/ActivitySection";
import { useLanguage, useT } from "@/ui/i18n";
import { useMemo, useRef, useState } from "react";
import { MdTranslate } from "react-icons/md";
import styles from "../settings.module.css";

interface Props {
  // A code in TRANSLATION_LANGUAGES, or "" while it's off
  language: string;
  onChange: (language: string) => void;
}

// Numbers the tests, on across mounts: a late reply for an older one is ignored
let tests = 0;

type Tested = {
  id: string;
  text: string;
  // The language it was tested in, so a result for another one isn't shown
  language: string;
  failure?: string;
  data?: TranslationTest;
};

export function TranslationSection({ language, onChange }: Props) {
  const t = useT();
  const lang = useLanguage();
  const [text, setText] = useState("");
  // What the latest test sent, then what came back
  const [tested, setTested] = useState<Tested | null>(null);
  const [testing, setTesting] = useState(false);
  const latest = useRef("");

  const options = useMemo(
    () => [
      { value: "", label: t("settings.translation.off") },
      ...TRANSLATION_LANGUAGES.map((code) => ({
        value: code,
        label: languageName(code, lang),
      })).sort((a, b) => a.label.localeCompare(b.label, lang)),
    ],
    [t, lang],
  );

  useIpcListener(APP_EVENTS_RESPONSE.TEST_TRANSLATION, (res) => {
    if (!res || res.id !== latest.current) return;
    setTesting(false);
    setTested(
      (last) =>
        last && {
          ...last,
          data: res.data,
          failure: res.success ? undefined : res.error?.message,
        },
    );
  });

  // A code main doesn't apply reads as off, as main treats it
  const picked = options.some((o) => o.value === language) ? language : "";

  const test = () => {
    latest.current = `translation-test:${++tests}`;
    setTesting(true);
    setTested({ id: latest.current, text, language: picked });
    window.api.emit(APP_EVENTS.TEST_TRANSLATION, { id: latest.current, text });
  };

  const shown = tested?.language === picked ? tested : null;
  const title = t("settings.translation.language");

  return (
    <Section
      icon={<MdTranslate />}
      title={t("settings.translation.title")}
      description={t("settings.translation.description")}
    >
      <FormGrid>
        <Field label={title}>
          <Select
            aria-label={title}
            searchable
            options={options}
            value={picked}
            onChange={onChange}
          />
        </Field>
      </FormGrid>

      {/* Nothing to test while it's off */}
      {picked !== "" && (
        <>
          <div className={styles.tester}>
            <Btn
              variant="accent"
              className={styles.tester_btn}
              loading={testing}
              disabled={text.trim() === ""}
              onClick={test}
            >
              {t("common.test")}
            </Btn>
            <Input
              placeholder={t("settings.translation.testPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <Result shown={shown} />
        </>
      )}
    </Section>
  );
}

// What the latest test in this language gave
function Result({ shown }: { shown: Tested | null }) {
  const t = useT();
  const lang = useLanguage();
  const data = shown?.data;
  return (
    <div aria-live="polite">
      {shown?.failure && <p className={styles.result}>{shown.failure}</p>}
      {data?.kind === "command" && (
        <p className={styles.result}>{t("settings.translation.command")}</p>
      )}
      {data?.kind === "same" && (
        <p className={styles.result}>
          {t("settings.translation.same", {
            language: languageName(data.from, lang),
          })}
        </p>
      )}
      {data?.kind === "translated" && shown && (
        <>
          <ol className={styles.preview}>
            <ChatRow
              user={{
                handle: "viewer",
                name: t("settings.translation.viewer"),
                picture: "",
              }}
              text={shown.text}
              emotes={[]}
              translation={data.translation}
            />
          </ol>
          <p className={styles.result}>
            {t("settings.translation.translated", {
              language: languageName(data.translation.from, lang),
            })}
          </p>
        </>
      )}
    </div>
  );
}
