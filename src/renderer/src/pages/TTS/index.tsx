import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import {
  FloatingSave,
  Page,
  PermissionsSection,
  ProtectionSection,
} from "@/components";
import {
  scopeUpdater,
  useAudio,
  useEditableSettings,
  useIpcListener,
} from "@/hooks";
import { useState } from "react";
import { FormatSection } from "./sections/FormatSection";
import { ProtectionFields } from "./sections/ProtectionFields";
import { ReplacementsSection } from "./sections/ReplacementsSection";
import { VoiceSection } from "./sections/VoiceSection";

// Id of the tester's requests, voice previews share the event
const TEST_ID = "tts-test";

export function TTS() {
  const { getQueue } = useAudio();
  const testQueue = getQueue("tts_test");

  const [testLoading, setTestLoading] = useState(false);

  const { draft, update, hasChanges, save } = useEditableSettings(
    "tts",
    "TTS",
    (settings) =>
      testQueue.setFilters({
        ...settings.filters,
        volume: settings.filters.volume / 100,
      }),
  );

  useIpcListener(APP_EVENTS_RESPONSE.GET_TTS_TEST, (res) => {
    if (res?.id !== TEST_ID) return;
    setTestLoading(false);
    if (res.success) testQueue.enqueue(res.data!, true);
  });

  return (
    <>
      <FloatingSave visible={hasChanges} onSave={save} />

      <Page>
        <VoiceSection
          settings={draft}
          testLoading={testLoading}
          testQueue={testQueue}
          update={update}
          onTest={(text) => {
            setTestLoading(true);
            // Read like chat, with the settings on the page, saved or not
            window.api.emit(APP_EVENTS.GET_TTS_TEST, {
              id: TEST_ID,
              text,
              voice: draft.voice,
              settings: draft,
            });
          }}
        />

        <FormatSection
          format={draft.format}
          update={scopeUpdater(update, "format")}
        />

        <PermissionsSection
          feature="TTS"
          permissions={draft.permissions}
          update={scopeUpdater(update, "permissions")}
        />

        <ProtectionSection
          feature="TTS"
          protection={draft.protection}
          update={scopeUpdater(update, "protection")}
        >
          <ProtectionFields
            protection={draft.protection}
            update={scopeUpdater(update, "protection")}
          />
        </ProtectionSection>

        <ReplacementsSection
          replacements={draft.replacements}
          update={scopeUpdater(update, "replacements")}
        />
      </Page>
    </>
  );
}
