type Decoded = Pick<
  AudioBuffer,
  "sampleRate" | "numberOfChannels" | "length" | "getChannelData"
>;

/**
 * Mixes each buffer to mono, joins them in order and cuts the result at
 * maxSeconds, as one 16-bit PCM WAV. The buffers share one sample rate, the
 * decoding context's.
 */
export function joinedWav(buffers: Decoded[], maxSeconds: number): Uint8Array {
  const rate = buffers[0]?.sampleRate ?? 44100;
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const frames = Math.min(total, Math.floor(maxSeconds * rate));
  const view = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };

  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);

  let at = 0;
  for (const buffer of buffers) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c),
    );
    for (let i = 0; i < buffer.length && at < frames; i++, at++) {
      const mixed =
        channels.reduce((sum, ch) => sum + ch[i], 0) / channels.length;
      const clipped = Math.max(-1, Math.min(1, mixed));
      view.setInt16(
        44 + at * 2,
        clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff,
        true,
      );
    }
  }
  return new Uint8Array(view.buffer);
}
