import { describe, expect, it } from "vitest";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import { ALERT_TRIGGERS } from "./profile";

describe("ALERT_TRIGGERS", () => {
  it("lists the live events but Room Users, without the internal ones", () => {
    for (const internal of [
      TOKIO_EVENTS.CONNECTED,
      TOKIO_EVENTS.DISCONNECTED,
      TOKIO_EVENTS.MUSIC_PROCCESS_ENDED,
      TOKIO_EVENTS.ROOM_USER,
    ]) {
      expect(ALERT_TRIGGERS).not.toContain(internal);
    }
    expect(ALERT_TRIGGERS).toContain(TOKIO_EVENTS.GIFT);
    expect(ALERT_TRIGGERS).toContain(TOKIO_EVENTS.MUSIC_CHANGE);
  });

  it("puts Emote right after Chat, the event it comes from", () => {
    const chat = ALERT_TRIGGERS.indexOf(TOKIO_EVENTS.CHAT);

    expect(ALERT_TRIGGERS[chat + 1]).toBe(EMOTE_TRIGGER);
    expect(ALERT_TRIGGERS.filter((t) => t === EMOTE_TRIGGER)).toHaveLength(1);
  });
});
