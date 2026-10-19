import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Page, PermissionsSection, ProtectionSection } from "@/components";
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

  const { settings, update } = useEditableSettings("tts", ({ tts }) =>
    testQueue.setFilters({
      ...tts.filters,
      volume: tts.filters.volume / 100,
    }),
  );

  useIpcListener(APP_EVENTS_RESPONSE.GET_TTS_TEST, (res) => {
    if (res?.id !== TEST_ID) return;
    setTestLoading(false);
    if (res.success) testQueue.enqueue(res.data!, true);
  });

  return (
    <Page>
      <VoiceSection
        settings={settings}
        testLoading={testLoading}
        testQueue={testQueue}
        update={update}
        onTest={(text) => {
          setTestLoading(true);
          // Read like chat, with the settings on the page, saved or not
          window.api.emit(APP_EVENTS.GET_TTS_TEST, {
            id: TEST_ID,
            text,
            voice: settings.voice,
            settings,
          });
        }}
      />

      <FormatSection
        format={settings.format}
        update={scopeUpdater(update, "format")}
      />

      <PermissionsSection
        feature="TTS"
        permissions={settings.permissions}
        update={scopeUpdater(update, "permissions")}
      />

      <ProtectionSection
        feature="TTS"
        protection={settings.protection}
        update={scopeUpdater(update, "protection")}
      >
        <ProtectionFields
          protection={settings.protection}
          update={scopeUpdater(update, "protection")}
        />
      </ProtectionSection>

      <ReplacementsSection
        replacements={settings.replacements}
        update={scopeUpdater(update, "replacements")}
      />
    </Page>
  );
}
