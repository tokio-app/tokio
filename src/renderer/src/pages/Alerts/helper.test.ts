import { TOKIO_EVENTS } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { alertClip, alertSound, gift } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  createAlert,
  emoteOptions,
  giftOptions,
  cutPart,
  soundClip,
  ttsDefaultsOf,
  waveform,
} from "./helper";

describe("createAlert", () => {
  it("makes an enabled follow alert without a sound, named by its place", () => {
    expect(createAlert(2)).toEqual({
      id: expect.any(String),
      name: "alert-3",
      enabled: true,
      trigger: {
        type: TOKIO_EVENTS.FOLLOW,
        gifts: [],
        every_gift: false,
        emotes: [],
        keyword: "",
        user: "",
        min_coins: 0,
        roles: [],
      },
      sound: null,
      tts: null,
      media: null,
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

describe("cutPart", () => {
  it("plays the cut, or the whole length when it doesn't fit", () => {
    expect(cutPart({ start: 1, end: 3 }, 10)).toEqual({ start: 1, stop: 3 });
    expect(cutPart({ start: 1, end: null }, 10)).toEqual({
      start: 1,
      stop: 10,
    });
    expect(cutPart({ start: 1, end: 30 }, 10)).toEqual({ start: 1, stop: 10 });
    expect(cutPart({ start: 12, end: null }, 10)).toEqual({
      start: 0,
      stop: 10,
    });
  });
});

describe("soundClip", () => {
  it("plays a new sound whole, and keeps the cut of the alert's own", () => {
    const cut = alertClip("Airhorn", { start: 0.5, end: 1 });

    expect(soundClip(alertSound("Bell"), cut)).toEqual(alertClip("Bell"));
    expect(soundClip(alertSound("Bell"), null)).toEqual(alertClip("Bell"));
    expect(soundClip({ ...alertSound("Airhorn"), name: "Horn" }, cut)).toEqual({
      ...cut,
      name: "Horn",
    });
  });
});

describe("waveform", () => {
  // Samples of two channels
  const buffer = (...channels: number[][]) => ({
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => Float32Array.from(channels[channel]),
  });

  it("gives each slice its loudest sample over the channels, the loudest 1", () => {
    const peaks = waveform(
      buffer([0, -0.5, 0.25, 0, 0.125, 0], [0, 0, 0, 0.25, 0, -0.0625]),
      3,
    );

    expect(peaks).toEqual([1, 0.5, 0.25]);
  });

  it("covers every slice when there are more slices than samples", () => {
    expect(waveform(buffer([0.5, 1]), 4)).toEqual([0.5, 0.5, 1, 1]);
  });

  it("stays flat for silence", () => {
    expect(waveform(buffer([0, 0, 0]), 3)).toEqual([0, 0, 0]);
  });
});
