import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure, settingsReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useServerEnabled } from "./useServerEnabled";
import { useTranslationLanguage } from "./useTranslationLanguage";

describe("useSetting", () => {
  it("gives its starting value until the settings say, then the setting", async () => {
    const server = renderHook(() => useServerEnabled());
    const language = renderHook(() => useTranslationLanguage());
    expect(sent(APP_EVENTS.GET_SETTINGS)).toHaveLength(2);
    expect(server.result.current).toBe(true);
    expect(language.result.current).toBe("");

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, failure());
    expect(server.result.current).toBe(true);

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = false;
        s.settings.translation.language = "es";
      }),
    );
    expect(server.result.current).toBe(false);
    expect(language.result.current).toBe("es");
  });
});
