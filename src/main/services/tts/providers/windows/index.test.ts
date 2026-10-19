import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import config from "./config";
import { WindowsTTS } from "./index";
import type { SapiRequest, SapiVoice } from "./types";

type FakeHost = {
  request: Mock<(req: SapiRequest) => Promise<unknown>>;
  dispose: Mock<() => void>;
};

// Each WindowsTTS gets its own host, the test answers its requests.
const hosts = vi.hoisted((): FakeHost[] => []);

vi.mock("./common/host", () => ({
  SapiHost: class {
    request = vi.fn<(req: SapiRequest) => Promise<unknown>>();
    dispose = vi.fn<() => void>();

    constructor() {
      hosts.push(this);
    }
  },
}));

const sapiVoice = (
  name: string,
  lang: string,
  engine: SapiVoice["engine"],
): SapiVoice => ({
  name,
  lang,
  gender: "Female",
  age: "Adult",
  vendor: "Microsoft",
  default: false,
  engine,
});

const VOICES = [
  sapiVoice("Microsoft Sabina Desktop", "es-MX", "sapi"),
  sapiVoice("Microsoft Aria", "en-US", "onecore"),
];

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("WindowsTTS", () => {
  let tts: WindowsTTS;
  let host: FakeHost;

  beforeEach(() => {
    hosts.length = 0;
    tts = new WindowsTTS();
    host = hosts[0];
    host.request.mockImplementation(async (req) =>
      req.type === "voices" ? VOICES : b64("wav"),
    );
  });

  const types = () => host.request.mock.calls.map(([req]) => req.type);

  it("lists the installed voices by name and language", async () => {
    await expect(tts.getVoices()).resolves.toEqual([
      { name: "Microsoft Sabina Desktop", lang: "es-MX" },
      { name: "Microsoft Aria", lang: "en-US" },
    ]);
    expect(host.request).toHaveBeenCalledExactlyOnceWith({ type: "voices" });
  });

  it("speaks with an installed voice and its engine", async () => {
    const res = await tts.generateBuffer(
      "Hola",
      "es-MX",
      "Microsoft Sabina Desktop",
    );

    expect(res).toEqual({ success: true, buffer: Buffer.from("wav") });
    expect(host.request).toHaveBeenLastCalledWith({
      type: "speak",
      text: "Hola",
      voice: "Microsoft Sabina Desktop",
      engine: "sapi",
      rate: config.DEFAULT_RATE,
      volume: config.DEFAULT_VOLUME,
    });

    await tts.generateBuffer("Hi", "en-US", "Microsoft Aria");
    expect(host.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ voice: "Microsoft Aria", engine: "onecore" }),
    );
  });

  it.each([
    ["an unknown voice", "Jessie"],
    ["no voice", undefined],
  ])("speaks with the system's default voice for %s", async (_name, voice) => {
    await tts.generateBuffer("Hello", "en", voice);

    const [req] = host.request.mock.lastCall ?? [];
    expect(req).toEqual({
      type: "speak",
      text: "Hello",
      rate: config.DEFAULT_RATE,
      volume: config.DEFAULT_VOLUME,
    });
    expect(req).not.toHaveProperty("voice", expect.anything());
    expect(req).not.toHaveProperty("engine", expect.anything());
  });

  it("asks for the voices once, when it first speaks", async () => {
    expect(host.request).not.toHaveBeenCalled();

    await tts.generateBuffer("One", "es-MX", "Microsoft Sabina Desktop");
    await tts.generateBuffer("Two", "es-MX", "Microsoft Sabina Desktop");

    expect(types()).toEqual(["voices", "speak", "speak"]);
  });

  it("reuses the voices it listed", async () => {
    await tts.getVoices();
    await tts.generateBuffer("Hola", "es-MX", "Microsoft Sabina Desktop");

    expect(types()).toEqual(["voices", "speak"]);
  });

  it("returns the host's error", async () => {
    const error = new Error('SAPI request "speak" timed out');
    host.request.mockResolvedValueOnce(VOICES).mockRejectedValueOnce(error);

    await expect(
      tts.generateBuffer("Hola", "es-MX", "Microsoft Sabina Desktop"),
    ).resolves.toEqual({
      success: false,
      error,
    });
  });

  it("fails when the voices can't be listed, and asks again next time", async () => {
    host.request.mockRejectedValueOnce(
      new Error("SAPI host exited with code 1"),
    );

    const res = await tts.generateBuffer(
      "Hola",
      "es-MX",
      "Microsoft Sabina Desktop",
    );

    expect(res.success).toBe(false);
    expect(res.error?.message).toBe("SAPI host exited with code 1");

    await tts.generateBuffer("Hola", "es-MX", "Microsoft Sabina Desktop");
    expect(types()).toEqual(["voices", "voices", "speak"]);
  });

  it("wraps a rejection that isn't an Error", async () => {
    host.request
      .mockResolvedValueOnce(VOICES)
      .mockRejectedValueOnce("host gone");

    const res = await tts.generateBuffer(
      "Hola",
      "es-MX",
      "Microsoft Sabina Desktop",
    );

    expect(res.success).toBe(false);
    expect(res.error).toBeInstanceOf(Error);
    expect(res.error?.message).toBe("host gone");
  });

  it("disposes of its host", () => {
    tts.dispose();

    expect(host.dispose).toHaveBeenCalledOnce();
  });
});
