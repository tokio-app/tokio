import {
  Alert,
  GameActionSchema,
  StudioElementSchema,
  StudioGroupSchema,
  StudioOverlaySchema,
  TriggerSchema,
} from "@/common/schemas";
import { AlertTrigger, EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { describe, expect, it } from "vitest";
import { chatCommands } from "./commands";

const trigger = (keyword: string, type: AlertTrigger = TOKIO_EVENTS.CHAT) =>
  TriggerSchema.parse({ type, gifts: [], keyword });

const alert = (
  keyword: string,
  enabled = true,
  type: AlertTrigger = TOKIO_EVENTS.CHAT,
): Alert => ({
  id: keyword,
  name: keyword,
  enabled,
  trigger: trigger(keyword, type),
  also_triggers: [],
  sound: null,
  tts: null,
  media: null,
  volume: 100,
});

const action = (keyword: string, enabled = true) =>
  GameActionSchema.parse({
    id: keyword,
    enabled,
    trigger: trigger(keyword),
    steps: [],
  });

const text = (keyword: string, when: "event" | "always") =>
  StudioElementSchema.parse({
    id: keyword,
    kind: "text",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    when,
    trigger: trigger(keyword),
  });

const services = (
  profile = structuredClone(defaultProfile),
  studio = [StudioOverlaySchema.parse({ id: crypto.randomUUID() })],
) => ({
  storeManagerService: {
    getProfileData: async () => profile,
    getStudio: () => studio,
  },
  overlayService: { chatCommands: () => ["!socials"] },
});

describe("chatCommands", () => {
  it("reads the profile's commands and the keywords of triggers that are on", async () => {
    const profile = structuredClone(defaultProfile);
    profile.tts.format.trigger = { mode: "custom", value: "!tts" };
    profile.music.controls.play = { enabled: true, command: "!play" };
    profile.music.controls.next = { enabled: false, command: "!next" };
    profile.alerts.items = [
      alert("hello"),
      alert("off", false),
      alert(""),
      // matchesTrigger reads no keyword on these
      alert("emote", true, EMOTE_TRIGGER),
      alert("follow", true, TOKIO_EVENTS.FOLLOW),
    ];
    profile.games.actions = [action("tnt"), action("creeper", false)];
    profile.timer.settings.chat.keyword = "time";
    profile.timer.settings.seconds.chat = 5;
    const studio = StudioOverlaySchema.parse({
      id: crypto.randomUUID(),
      items: [
        text("wave", "event"),
        text("still", "always"),
        StudioGroupSchema.parse({
          id: "group",
          kind: "group",
          when: "animate",
          trigger: trigger("jump"),
          elements: [text("inner", "event")],
        }),
      ],
    });

    const commands = await chatCommands(services(profile, [studio]));

    expect(commands.trigger).toBe("!tts");
    expect(commands.commands).toContain("!play");
    expect(commands.commands).not.toContain("!next");
    expect(commands.commands).toContain("!socials");
    expect(commands.keywords).toEqual([
      "hello",
      "tnt",
      "wave",
      "jump",
      "inner",
      "time",
    ]);
  });

  it("keeps the keywords of an alert's Or rows", async () => {
    const profile = structuredClone(defaultProfile);
    profile.alerts.items = [
      {
        ...alert("first", true, TOKIO_EVENTS.FOLLOW),
        also_triggers: [trigger("second")],
      },
      { ...alert("off", false), also_triggers: [trigger("hidden")] },
    ];

    expect((await chatCommands(services(profile))).keywords).toEqual([
      "second",
    ]);
  });

  it("leaves out the timer's keyword while chat adds no time", async () => {
    const profile = structuredClone(defaultProfile);
    profile.timer.settings.chat.keyword = "time";
    profile.timer.settings.seconds.chat = 0;

    expect((await chatCommands(services(profile))).keywords).toEqual([]);
  });

  it("has no trigger while TTS reads every message", async () => {
    const profile = structuredClone(defaultProfile);
    profile.tts.format.trigger = { mode: "any", value: "!tts" };

    expect((await chatCommands(services(profile))).trigger).toBe("");
  });
});
