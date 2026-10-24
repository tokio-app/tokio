import { describe, expect, it } from "vitest";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import { defaultProfile } from "../util/constants/profile";
import {
  ALERT_TRIGGERS,
  GameStepSchema,
  Profile,
  ProfileSchema,
} from "./profile";

describe("ProfileSchema", () => {
  it("gives a profile saved before the countdown timer the timer's defaults", () => {
    const saved: Partial<Profile> = structuredClone(defaultProfile);
    delete saved.timer;

    const { timer } = ProfileSchema.parse(saved);

    expect(timer).toMatchObject({
      status: "idle",
      remaining: 0,
      settings: {
        start: 60,
        multiplier: 1,
        pause_on_end: true,
        seconds: { coin: 1, likes: 10, likes_every: 100, chat: 0 },
        look: { title: "", show_multiplier: true, accent_color: "#f43f5e" },
      },
    });
    expect(timer).toEqual(defaultProfile.timer);
  });

  it("gives a profile saved before games no game actions", () => {
    const saved: Partial<Profile> = structuredClone(defaultProfile);
    delete saved.games;

    expect(ProfileSchema.parse(saved).games).toEqual({ actions: [] });
  });

  it("fills a spawn step's amount and name", () => {
    const step = GameStepSchema.parse({ type: "spawn", mob: "zombie" });

    expect(step).toEqual({ type: "spawn", mob: "zombie", amount: 1, name: "" });
  });

  it("refuses a step that spawns more than the most at once", () => {
    const step = { type: "spawn", mob: "zombie", amount: 101 };

    expect(GameStepSchema.safeParse(step).success).toBe(false);
  });

  it("refuses a timer color that isn't a hex color", () => {
    const saved = structuredClone(defaultProfile);
    saved.timer.settings.look.clock_color = "red; background: url(x)";

    expect(ProfileSchema.safeParse(saved).success).toBe(false);
  });
});

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
