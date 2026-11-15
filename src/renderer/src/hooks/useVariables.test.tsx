import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { settingsReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranslationLanguage } from "./useTranslationLanguage";
import { useVariables } from "./useVariables";

const reply = (language: string) =>
  settingsReply((s) => {
    s.settings.translation.language = language;
  });

describe("useTranslationLanguage", () => {
  it("is off until the settings say, then follows them", async () => {
    const { result } = renderHook(useTranslationLanguage);
    expect(result.current).toBe("");
    expect(sent(APP_EVENTS.GET_SETTINGS)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply("pt"));
    expect(result.current).toBe("pt");

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply(""));
    expect(result.current).toBe("");
  });
});

describe("useVariables", () => {
  const list = ["username", "comment", "translation"];

  it("drops {translation} while translation is off", async () => {
    const { result } = renderHook(() => useVariables(list));
    expect(result.current).toEqual(["username", "comment"]);

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply(""));
    expect(result.current).toEqual(["username", "comment"]);
  });

  it("keeps it with a language", async () => {
    const { result } = renderHook(() => useVariables(list));

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply("es"));

    expect(result.current).toEqual(list);
  });
});
