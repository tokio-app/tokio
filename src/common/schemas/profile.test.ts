import { describe, expect, it } from "vitest";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import { defaultProfile } from "../util/constants/profile";
import {
  ALERT_TRIGGERS,
  GameActionSchema,
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

  it("gives TTS settings saved before special users none", () => {
    const saved = structuredClone(defaultProfile);
    const tts: Partial<Profile["tts"]> = saved.tts;
    delete tts.user_voices;

    expect(ProfileSchema.parse(saved).tts.user_voices).toEqual([]);
  });

  it("gives a profile saved before games no game actions", () => {
    const saved: Partial<Profile> = structuredClone(defaultProfile);
    delete saved.games;

    expect(ProfileSchema.parse(saved).games).toEqual({
      actions: [],
      overlay: defaultProfile.games.overlay,
    });
  });

  it("gives games saved before the overlay its default look", () => {
    const saved = structuredClone(defaultProfile);
    const games: Partial<Profile["games"]> = saved.games;
    delete games.overlay;

    expect(ProfileSchema.parse(saved).games.overlay).toEqual({
      layout: "list",
      format: "arrow",
      columns: 1,
      pictures_only: false,
      text_below: false,
      event_size: "small",
      font: "",
      text_color: "#f1f5f9",
      accent_color: "#f43f5e",
      arrow_color: "#f43f5e",
    });
  });

  it("gives a look saved before the formats the arrow, in Tokio's rose", () => {
    const saved = structuredClone(defaultProfile);
    const look: Partial<Profile["games"]["overlay"]> = saved.games.overlay;
    delete look.format;
    delete look.arrow_color;

    expect(ProfileSchema.parse(saved).games.overlay).toMatchObject({
      format: "arrow",
      arrow_color: "#f43f5e",
    });
  });

  // As saved before Java and the overlay
  const oldAction = {
    id: "action-1",
    enabled: true,
    trigger: {
      type: TOKIO_EVENTS.FOLLOW,
      gifts: [],
      every_gift: false,
      emotes: [],
      keyword: "",
      user: "",
    },
    steps: [],
  };

  it("plays an alert saved before cuts whole, for anyone and any gift", () => {
    const saved = {
      ...defaultProfile,
      alerts: {
        ...defaultProfile.alerts,
        items: [
          {
            id: "alert-1",
            enabled: true,
            trigger: { ...oldAction.trigger, type: TOKIO_EVENTS.GIFT },
            sound: { name: "Ding", file: "ding.mp3" },
            media: { name: "Party", file: "party.png", duration: 5 },
            volume: 80,
          },
        ],
      },
    };

    const [alert] = ProfileSchema.parse(saved).alerts.items;

    expect(alert.sound).toEqual({
      name: "Ding",
      file: "ding.mp3",
      start: 0,
      end: null,
    });
    expect(alert.media).toMatchObject({ start: 0, end: null });
    expect(alert.trigger).toMatchObject({ min_coins: 0, roles: [] });
  });

  describe("media saved before", () => {
    const clip = { name: "Clip", file: "clip.webm", duration: 5 };
    const alert = (saved: object, volume = 80) => ({
      id: "alert-1",
      enabled: true,
      trigger: { ...oldAction.trigger, type: TOKIO_EVENTS.FOLLOW },
      sound: null,
      media: saved,
      volume,
    });
    const parse = (...items: object[]) =>
      ProfileSchema.parse({
        ...defaultProfile,
        alerts: { ...defaultProfile.alerts, items },
      }).alerts.items.map((item) => item.media);

    it("its own volume plays at the alert's", () => {
      const media = parse(alert(clip, 40), alert({ ...clip, volume: 90 }, 40));

      expect(media.map((m) => m?.volume)).toEqual([40, 90]);
    });

    it("cuts stops where its duration did, unless it matched the video", () => {
      const media = parse(
        alert(clip),
        alert({ ...clip, match_video: true }),
        alert({ ...clip, file: "party.png" }),
        alert({ ...clip, start: 1, end: null }),
      );

      expect(media.map((m) => [m?.start, m?.end])).toEqual([
        [0, 5],
        [0, null],
        [0, null],
        [1, null],
      ]);
      expect(media[1]).not.toHaveProperty("match_video");
    });
  });

  it("names alerts saved before names by their place, after Room Users", () => {
    const alert = (type: string, name?: string) => ({
      id: type,
      ...(name !== undefined && { name }),
      enabled: true,
      trigger: { ...oldAction.trigger, type },
      sound: null,
      volume: 80,
    });
    const items = [
      alert(TOKIO_EVENTS.ROOM_USER),
      alert(TOKIO_EVENTS.FOLLOW),
      alert(TOKIO_EVENTS.SHARE, "Shares"),
      alert(TOKIO_EVENTS.LIKE),
    ];

    const saved = ProfileSchema.parse({
      ...defaultProfile,
      alerts: { ...defaultProfile.alerts, items },
    }).alerts.items;

    expect(saved.map((a) => a.name)).toEqual(["alert-1", "Shares", "alert-3"]);
  });

  it("makes a game action saved before Java a Bedrock one", () => {
    expect(GameActionSchema.parse(oldAction).edition).toBe("bedrock");
  });

  it("shows a game action saved before the overlay on it, without a picture", () => {
    expect(GameActionSchema.parse(oldAction).overlay).toEqual({
      show: true,
      image: null,
      event: "",
      name: "",
      column: 1,
    });
  });

  it("refuses more columns than the games overlay splits into", () => {
    const action = { ...oldAction, overlay: { column: 5 } };

    expect(GameActionSchema.safeParse(action).success).toBe(false);
  });

  it("refuses an overlay name longer than 40 characters", () => {
    const action = { ...oldAction, overlay: { name: "x".repeat(41) } };

    expect(GameActionSchema.safeParse(action).success).toBe(false);
  });

  it("fills a spawn step's amount and name", () => {
    const step = GameStepSchema.parse({ type: "spawn", mob: "zombie" });

    expect(step).toEqual({ type: "spawn", mob: "zombie", amount: 1, name: "" });
  });

  it("refuses a step that spawns more than the most at once", () => {
    const step = { type: "spawn", mob: "zombie", amount: 101 };

    expect(GameStepSchema.safeParse(step).success).toBe(false);
  });

  it("drops the steps of the creeper's hiss, a hazard no more", () => {
    const action = GameActionSchema.parse({
      ...oldAction,
      steps: [
        { type: "hazard", hazard: "creeper_hiss" },
        { type: "hazard", hazard: "tnt" },
      ],
    });

    expect(action.steps).toMatchObject([{ type: "hazard", hazard: "tnt" }]);
  });

  it("makes the armor sets helps no more netherite", () => {
    const action = GameActionSchema.parse({
      ...oldAction,
      steps: [{ type: "help", help: "diamond_armor" }],
    });

    expect(action.steps).toEqual([
      { type: "help", help: "netherite_armor", duration: 30 },
    ]);
  });

  it("refuses a hazard Tokio doesn't have", () => {
    const step = { type: "hazard", hazard: "lava" };

    expect(GameStepSchema.safeParse(step).success).toBe(false);
  });

  it("refuses a timer color that isn't a hex color", () => {
    const saved = structuredClone(defaultProfile);
    saved.timer.settings.look.clock_color = "red; background: url(x)";

    expect(ProfileSchema.safeParse(saved).success).toBe(false);
  });

  it("refuses a games overlay color that isn't a hex color", () => {
    const saved = structuredClone(defaultProfile);
    saved.games.overlay.accent_color = "red; background: url(x)";

    expect(ProfileSchema.safeParse(saved).success).toBe(false);
    saved.games.overlay.accent_color = "#f43f5e";
    saved.games.overlay.arrow_color = "red; background: url(x)";
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
