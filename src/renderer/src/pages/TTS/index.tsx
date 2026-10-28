import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Page, PermissionsSection, ProtectionSection } from "@/components";
import {
  scopeUpdater,
  useAudio,
  useEditableSettings,
  useIpcListener,
} from "@/hooks";
import { useT } from "@/ui/i18n";
import { useEffect, useState } from "react";
import { FormatSection } from "./sections/FormatSection";
import { ProtectionFields } from "./sections/ProtectionFields";
import { ReplacementsSection } from "./sections/ReplacementsSection";
import { UserVoicesSection } from "./sections/UserVoicesSection";
import { VoiceSection } from "./sections/VoiceSection";

// Id of the tester's requests, voice previews share the event
const TEST_ID = "tts-test";

export function TTS() {
  const t = useT();
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
    if (!res.success) return;
    // A new test replaces the one playing
    testQueue.stop();
    testQueue.enqueue(res.data!);
  });

  // Leaving the page cuts the test.
  useEffect(() => () => testQueue.stop(), [testQueue]);

  return (
    <Page width="wide" layout="aside">
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

      <UserVoicesSection
        userVoices={settings.user_voices}
        voice={settings.voice}
        filters={settings.filters}
        update={scopeUpdater(update, "user_voices")}
      />

      <FormatSection
        format={settings.format}
        update={scopeUpdater(update, "format")}
      />

      <PermissionsSection
        feature={t("nav.tts")}
        permissions={settings.permissions}
        update={scopeUpdater(update, "permissions")}
      />

      <ProtectionSection
        feature={t("nav.tts")}
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
