import { TOKIO_EVENTS } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { gift } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  createAlert,
  emoteOptions,
  giftOptions,
  ttsDefaultsOf,
} from "./helper";

describe("createAlert", () => {
  it("makes an enabled follow alert without a sound", () => {
    expect(createAlert()).toEqual({
      id: expect.any(String),
      enabled: true,
      trigger: {
        type: TOKIO_EVENTS.FOLLOW,
        gifts: [],
        emotes: [],
        keyword: "",
        user: "",
      },
      sound: null,
      tts: null,
      volume: 100,
    });
  });

  it("gives each alert its own id", () => {
    expect(createAlert().id).not.toBe(createAlert().id);
  });
});

describe("ttsDefaultsOf", () => {
  it("takes the TTS page's voice, speed and pitch", () => {
    const tts = structuredClone(defaultProfile.tts);
    tts.filters = { speed: 1.5, pitch: 0.8, volume: 30 };

    expect(ttsDefaultsOf(tts)).toEqual({
      voice: tts.voice,
      speed: 1.5,
      pitch: 0.8,
    });
  });
});

describe("emoteOptions", () => {
  it("numbers the emotes in the order they were seen", () => {
    const emotes = [
      { id: "e1", image: "https://example.com/e1.png" },
      { id: "e2", image: "https://example.com/e2.png" },
    ];

    expect(emoteOptions(emotes)).toEqual([
      { value: "e1", label: "Emote 1", img: "https://example.com/e1.png" },
      { value: "e2", label: "Emote 2", img: "https://example.com/e2.png" },
    ]);
  });
});

describe("giftOptions", () => {
  // The fixture's gifts cost their id in coins
  const rose = gift(1, "Rose");
  const heart = { ...gift(8, "Heart Me"), coins: 1 };
  const galaxy = gift(1000, "Galaxy");
  const lion = gift(29999, "Lion");

  it("adds the gifts saved from LIVEs to TikTok's, cheapest first, then by name", () => {
    const listed = [lion, rose];

    expect(giftOptions(listed, [galaxy, heart])).toEqual([
      heart,
      rose,
      galaxy,
      lion,
    ]);
    expect(listed).toEqual([lion, rose]);
  });

  it("lists a gift TikTok also has once, as TikTok has it", () => {
    expect(giftOptions([rose], [{ ...rose, label: "Old Rose" }])).toEqual([
      rose,
    ]);
  });
});
