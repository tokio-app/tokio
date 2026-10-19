import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioQueue } from "./audio";

// A Tone.js stand-in that records what the queue builds and schedules
const tone = vi.hoisted(() => {
  class FakeParam {
    constructor(public value: number) {}
    rampTo(value: number) {
      this.value = value;
    }
  }

  class FakeGain {
    gain: FakeParam;
    disposed = false;
    constructor(value = 1) {
      this.gain = new FakeParam(value);
      gains.push(this);
    }
    toDestination() {
      return this;
    }
    connect() {
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }

  class FakeBuffer {
    constructor(readonly raw: { duration: number }) {}
    get duration() {
      return this.raw.duration;
    }
  }

  class FakePlayer {
    playbackRate: number;
    detune: number;
    startedAt: number | null = null;
    stopped = false;
    disposed = false;
    onstop = () => {};
    constructor(options: { playbackRate: number; detune: number }) {
      this.playbackRate = options.playbackRate;
      this.detune = options.detune;
      players.push(this);
    }
    connect() {
      return this;
    }
    start(time: number) {
      this.startedAt = time;
    }
    stop() {
      this.stopped = true;
    }
    dispose() {
      this.disposed = true;
    }
    // The audio played to its end
    finish() {
      this.onstop();
    }
  }

  const players: FakePlayer[] = [];
  const gains: FakeGain[] = [];
  const clock = { now: 10 };
  const decode = vi.fn<(data: ArrayBuffer) => Promise<{ duration: number }>>();

  return { FakeGain, FakeBuffer, FakePlayer, players, gains, clock, decode };
});

vi.mock("tone", () => ({
  Gain: tone.FakeGain,
  GrainPlayer: tone.FakePlayer,
  ToneAudioBuffer: tone.FakeBuffer,
  getContext: () => ({ decodeAudioData: tone.decode }),
  now: () => tone.clock.now,
}));

const bytes = () => new Uint8Array([1, 2, 3, 4]);

// Each sound lasts 2 seconds
beforeEach(() => {
  tone.players.length = 0;
  tone.gains.length = 0;
  tone.clock.now = 10;
  tone.decode.mockReset();
  tone.decode.mockResolvedValue({ duration: 2 });
});

describe("AudioQueue", () => {
  it("plays sounds back to back, with the gap between them", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ gapTime: 0.5 });

    await queue.enqueue(bytes());
    await queue.enqueue(bytes(), true, { speed: 2 });
    await queue.enqueue(bytes());

    expect(tone.players.map((p) => p.startedAt)).toEqual([10, 12.5, 14]);
    expect(queue.isPlaying).toBe(true);
  });

  it("waits for start() when autoplay is off", async () => {
    const queue = new AudioQueue();

    expect(await queue.enqueue(bytes(), false)).toBe(true);
    expect(tone.players).toHaveLength(0);

    queue.start();
    expect(tone.players).toHaveLength(1);
  });

  it("ignores sounds once waiting and playing ones reach the limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new AudioQueue();
    queue.setQueueOptions({ maxQueueLength: 2 });

    expect(await queue.enqueue(bytes())).toBe(true);
    expect(await queue.enqueue(bytes(), false)).toBe(true);
    expect(await queue.enqueue(bytes())).toBe(false);
    expect(tone.decode).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();

    // One finished, so there's room again
    tone.players[0].finish();
    expect(await queue.enqueue(bytes())).toBe(true);
  });

  it("drops sounds still decoding when it's stopped", async () => {
    let decoded!: (buffer: { duration: number }) => void;
    tone.decode.mockReturnValueOnce(
      new Promise((resolve) => {
        decoded = resolve;
      }),
    );
    const queue = new AudioQueue();

    const pending = queue.enqueue(bytes());
    queue.stop();
    decoded({ duration: 2 });

    expect(await pending).toBe(false);
    expect(tone.players).toHaveLength(0);
  });

  it("calls onEnded when a sound ends, not when it's stopped", async () => {
    const ended = vi.fn();
    const cut = vi.fn();
    const queue = new AudioQueue();

    await queue.enqueue(bytes(), true, { onEnded: ended });
    tone.players[0].finish();
    expect(ended).toHaveBeenCalledOnce();

    await queue.enqueue(bytes(), true, { onEnded: cut });
    const player = tone.players[1];
    queue.stop();
    player.finish();

    expect(player.stopped).toBe(true);
    expect(player.disposed).toBe(true);
    expect(cut).not.toHaveBeenCalled();
  });

  it("starts over with a fresh output at the same volume", async () => {
    const queue = new AudioQueue();
    queue.setFilters({ volume: 0.5 });
    const [output] = tone.gains;

    queue.stop();

    expect(output.disposed).toBe(true);
    expect(tone.gains.at(-1)?.gain.value).toBe(0.5);
    expect(await queue.enqueue(bytes())).toBe(true);
  });

  it("keeps filters in range", async () => {
    const queue = new AudioQueue();
    queue.setFilters({ volume: 9, speed: 5, pitch: 0.1 });
    await queue.enqueue(bytes());

    expect(tone.gains[0].gain.value).toBe(4);
    expect(tone.players[0].playbackRate).toBe(2);
    expect(tone.players[0].detune).toBe(-1200);

    queue.setFilters({ volume: -1 });
    expect(tone.gains[0].gain.value).toBe(0);
  });

  it("changes playing sounds, except the ones with their own speed and pitch", async () => {
    const queue = new AudioQueue();
    await queue.enqueue(bytes());
    await queue.enqueue(bytes(), true, { speed: 1.5 });
    const [shared, own] = tone.players;

    queue.setFilters({ speed: 0.8, pitch: 2 });

    expect(shared.playbackRate).toBe(0.8);
    expect(shared.detune).toBe(1200);
    expect(own.playbackRate).toBe(1.5);
    expect(own.detune).toBe(0);
  });

  it("sets the volume of waiting and playing sounds by key", async () => {
    const queue = new AudioQueue();
    await queue.enqueue(bytes(), true, { key: "playing" });
    const playingGain = tone.gains.at(-1)!;
    await queue.enqueue(bytes(), false, { key: "waiting", gain: 1 });

    queue.setItemGain("playing", 0.2);
    queue.setItemGain("waiting", 0.3);
    queue.setItemGain("other", 0.9);
    queue.start();

    expect(playingGain.gain.value).toBe(0.2);
    expect(tone.gains.at(-1)?.gain.value).toBe(0.3);
  });

  it("decodes IPC bytes without copying them, and copies a view", async () => {
    const queue = new AudioQueue();
    const whole = bytes();
    const view = new Uint8Array(new ArrayBuffer(16), 4, 3);

    await queue.enqueue(whole);
    await queue.enqueue(view);

    expect(tone.decode.mock.calls[0][0]).toBe(whole.buffer);
    const copied = tone.decode.mock.calls[1][0];
    expect(copied).not.toBe(view.buffer);
    expect(copied.byteLength).toBe(3);
  });

  it("downloads a URL before decoding it", async () => {
    const buffer = new ArrayBuffer(8);
    const fetch = vi.fn(async () => ({ arrayBuffer: async () => buffer }));
    vi.stubGlobal("fetch", fetch);
    const queue = new AudioQueue();

    expect(await queue.enqueue("https://example.com/a.mp3")).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://example.com/a.mp3");
    expect(tone.decode).toHaveBeenCalledWith(buffer);
  });

  it("resolves false when the audio can't be decoded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    tone.decode.mockRejectedValueOnce(new Error("Unable to decode"));
    const queue = new AudioQueue();

    expect(await queue.enqueue(bytes())).toBe(false);
    expect(error).toHaveBeenCalled();
    expect(tone.players).toHaveLength(0);
  });
});
