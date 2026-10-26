import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { gift } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTriggerChoices } from "./useTriggerChoices";

describe("useTriggerChoices", () => {
  it("asks for the gifts and keeps up with main's pushes", async () => {
    const { result } = renderHook(() => useTriggerChoices());
    expect(sent(APP_EVENTS.GET_GIFTS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_CUSTOM_GIFTS)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5, "Lion"), gift(1, "Rose")],
    });
    await send(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
      data: [gift(1, "Rose"), gift(3, "Comet")],
    });
    expect(result.current.giftChoices.map((g) => g.label)).toEqual([
      "Rose",
      "Comet",
      "Lion",
    ]);

    // The page sets the profile's emotes, then main pushes new ones
    act(() => result.current.setEmotes([{ id: "e1", image: "e1.png" }]));
    await send(APP_EVENTS_RESPONSE.EMOTES, {
      data: [
        { id: "e1", image: "e1.png" },
        { id: "e2", image: "e2.png" },
      ],
    });
    expect(result.current.emotes).toHaveLength(2);
    expect(result.current.emoteChoices).toEqual([
      { value: "e1", label: "Emote 1", img: "e1.png" },
      { value: "e2", label: "Emote 2", img: "e2.png" },
    ]);
  });
});
