import { describe, expect, it } from "vitest";
import { joinedWav } from "./wav";

const buffer = (sampleRate: number, ...channels: number[][]) => ({
  sampleRate,
  numberOfChannels: channels.length,
  length: channels[0].length,
  getChannelData: (c: number) => Float32Array.from(channels[c]),
});

const read = (wav: Uint8Array) => new DataView(wav.buffer);
const text = (wav: Uint8Array, at: number) =>
  String.fromCharCode(...wav.slice(at, at + 4));
const samples = (wav: Uint8Array) =>
  Array.from(new Int16Array(wav.buffer.slice(44)));

describe("joinedWav", () => {
  it("writes a mono 16-bit PCM header", () => {
    const wav = joinedWav([buffer(8000, [0, 0, 0])], 10);
    const view = read(wav);

    expect(wav).toHaveLength(44 + 6);
    expect(text(wav, 0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(text(wav, 8)).toBe("WAVE");
    expect(text(wav, 12)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(16000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(wav, 36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
  });

  it("converts samples to 16 bits, clipping what's past full scale", () => {
    const wav = joinedWav([buffer(8000, [0, 1, -1, 0.5, 2, -3])], 10);

    expect(samples(wav)).toEqual([0, 32767, -32768, 16383, 32767, -32768]);
  });

  it("mixes the channels to mono and joins the buffers in order", () => {
    const wav = joinedWav(
      [buffer(8000, [1, 0.5], [0, -0.5]), buffer(8000, [-1])],
      10,
    );

    expect(samples(wav)).toEqual([16383, 0, -32768]);
  });

  it("cuts the joined audio at the longest length", () => {
    const wav = joinedWav([buffer(2, [1, 1, 1]), buffer(2, [-1, -1])], 2);

    expect(samples(wav)).toEqual([32767, 32767, 32767, -32768]);
    expect(read(wav).getUint32(40, true)).toBe(8);
  });
});
