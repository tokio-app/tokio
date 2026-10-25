import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioQueue,
  CUT_FADE,
  DECODED_CACHE_BYTES,
  forgetDecoded,
} from "./audio";

type FakeAudio = { duration: number; length: number; numberOfChannels: number };

// A Tone.js stand-in that records what the queue builds and schedules
const tone = vi.hoisted(() => {
  class FakeParam {
    // Values set ahead, as [value, time]
    scheduled: [number, number][] = [];
    constructor(public value: number) {}
    rampTo(value: number) {
      this.value = value;
    }
    setValueAtTime(value: number, time: number) {
      this.scheduled.push([value, time]);
    }
    linearRampToValueAtTime(value: number, time: number) {
      this.scheduled.push([value, time]);
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

  class FakePlayer {
    url: unknown;
    playbackRate: number;
    detune: number;
    startedAt: number | null = null;
    // The seconds of the sound it starts from, and plays for
    offset?: number;
    length?: number;
    stopped = false;
    disposed = false;
    onstop = () => {};
    constructor(options: {
      url: unknown;
      playbackRate: number;
      detune: number;
    }) {
      this.url = options.url;
      this.playbackRate = options.playbackRate;
      this.detune = options.detune;
      players.push(this);
    }
    connect() {
      return this;
    }
    start(time: number, offset?: number, length?: number) {
      this.startedAt = time;
      this.offset = offset;
      this.length = length;
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
  const decode = vi.fn<(data: ArrayBuffer) => Promise<FakeAudio>>();

  return { FakeGain, FakePlayer, players, gains, clock, decode };
});

vi.mock("tone", () => ({
  Gain: tone.FakeGain,
  GrainPlayer: tone.FakePlayer,
  getContext: () => ({
    decodeAudioData: tone.decode,
    createBuffer: (channels: number, length: number, rate: number) => ({
      duration: length / rate,
      length,
      numberOfChannels: channels,
    }),
  }),
  now: () => tone.clock.now,
  // What's heard, behind now() by Tone's look ahead
  immediate: () => tone.clock.now - 0.25,
}));

const bytes = () => new Uint8Array([1, 2, 3, 4]);

// A sound of 2 seconds that takes this many bytes decoded
const audio = (size = 4): FakeAudio => ({
  duration: 2,
  length: size / 4,
  numberOfChannels: 1,
});

// The next decode finishes when the test calls what this returns.
const held = () => {
  let done!: () => void;
  tone.decode.mockReturnValueOnce(
    new Promise((resolve) => {
      done = () => resolve(audio());
    }),
  );
  return () => done();
};

// Each decode makes a new buffer
beforeEach(() => {
  tone.players.length = 0;
  tone.gains.length = 0;
  tone.clock.now = 10;
  tone.decode.mockReset();
  tone.decode.mockImplementation(async () => audio());
});

describe("AudioQueue", () => {
  it("plays sounds back to back, with the gap between them", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ gapTime: 0.5 });

    await queue.enqueue(bytes());
    await queue.enqueue(bytes(), { speed: 2 });
    await queue.enqueue(bytes());

    expect(tone.players.map((p) => p.startedAt)).toEqual([10, 12.5, 14]);
  });

  it("ignores sounds once playing ones reach the limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new AudioQueue();
    queue.setQueueOptions({ maxQueueLength: 2 });

    expect(await queue.enqueue(bytes())).toBe(true);
    expect(await queue.enqueue(bytes())).toBe(true);
    expect(await queue.enqueue(bytes())).toBe(false);
    expect(tone.decode).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();

    // One finished, so there's room again
    tone.players[0].finish();
    expect(await queue.enqueue(bytes())).toBe(true);
  });

  it("holds a sound's place at least minDuration, and says when it's heard", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ gapTime: 0.5 });
    const onScheduled = vi.fn();

    await queue.enqueue(bytes(), { minDuration: 5, onScheduled });
    await queue.enqueue(bytes(), { minDuration: 1, onScheduled });

    expect(tone.players.map((p) => p.startedAt)).toEqual([10, 15.5]);
    expect(onScheduled.mock.calls).toEqual([
      [0.25, 5],
      [5.75, 2],
    ]);
  });

  it("holds silent places, which count toward the limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new AudioQueue();
    queue.setQueueOptions({ maxQueueLength: 2, gapTime: 0.5 });
    queue.setFilters({ speed: 2 });

    expect(await queue.wait(3)).toBe(true);
    expect(await queue.enqueue(bytes())).toBe(true);
    expect(await queue.wait(3)).toBe(false);
    expect(warn).toHaveBeenCalled();

    // The queue's speed doesn't shorten a wait.
    expect(tone.players.map((p) => p.startedAt)).toEqual([10, 13.5]);
    expect(tone.players[0].playbackRate).toBe(1);

    // Silent places of the same length share one buffer.
    tone.players[0].finish();
    expect(await queue.wait(3)).toBe(true);
    expect(tone.players[2].url).toBe(tone.players[0].url);
  });

  it("keeps a silent place behind a sound still decoding", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ gapTime: 0.5 });
    const decoded = held();

    const sound = queue.enqueue(bytes());
    const silent = queue.wait(3);
    await Promise.resolve();
    expect(tone.players).toHaveLength(0);

    decoded();
    expect(await Promise.all([sound, silent])).toEqual([true, true]);
    // The sound, then the silence
    expect(tone.players.map((p) => p.startedAt)).toEqual([10, 12.5]);
    expect(tone.players[1].playbackRate).toBe(1);
  });

  it("plays sounds in the order they came, however long each decodes", async () => {
    const queue = new AudioQueue();
    const first = audio();
    let decoded!: () => void;
    tone.decode.mockReturnValueOnce(
      new Promise((resolve) => {
        decoded = () => resolve(first);
      }),
    );

    const slow = queue.enqueue(bytes());
    const quick = queue.enqueue(bytes());
    // The quick one waits for its turn
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tone.players).toHaveLength(0);

    decoded();
    await Promise.all([slow, quick]);
    expect(tone.players.map((p) => [p.url === first, p.startedAt])).toEqual([
      [true, 10],
      [false, 12],
    ]);
  });

  it("handles a failed decode behind one still decoding", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = new AudioQueue();
    const decoded = held();
    tone.decode.mockRejectedValueOnce(new Error("Unable to decode"));

    const first = queue.enqueue(bytes());
    const failed = queue.enqueue(bytes());
    await new Promise((resolve) => setTimeout(resolve, 0));
    decoded();

    expect(await failed).toBe(false);
    expect(await first).toBe(true);
    expect(error).toHaveBeenCalledOnce();
    // The chain goes on
    expect(await queue.enqueue(bytes())).toBe(true);
    expect(tone.players).toHaveLength(2);
  });

  it("doesn't keep later sounds waiting for ones dropped on stop", async () => {
    const queue = new AudioQueue();
    held();

    // Its decode never finishes
    void queue.enqueue(bytes());
    queue.stop();

    expect(await queue.enqueue(bytes())).toBe(true);
    expect(tone.players).toHaveLength(1);
  });

  it("counts sounds still decoding, so it never decodes one that doesn't fit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new AudioQueue();
    queue.setQueueOptions({ maxQueueLength: 1 });
    const decoded = held();

    const first = queue.enqueue(bytes());
    expect(await queue.enqueue(bytes())).toBe(false);
    expect(tone.decode).toHaveBeenCalledOnce();

    decoded();
    expect(await first).toBe(true);
    expect(tone.players).toHaveLength(1);
  });

  it("gives the place back when a sound can't be decoded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tone.decode.mockRejectedValueOnce(new Error("Unable to decode"));
    const queue = new AudioQueue();
    queue.setQueueOptions({ maxQueueLength: 1 });

    expect(await queue.enqueue(bytes())).toBe(false);
    expect(await queue.enqueue(bytes())).toBe(true);
  });

  it("drops sounds still decoding when it's stopped, and their places", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ maxQueueLength: 1 });
    const decoded = held();

    const pending = queue.enqueue(bytes());
    queue.stop();
    decoded();

    expect(await pending).toBe(false);
    expect(tone.players).toHaveLength(0);
    expect(await queue.enqueue(bytes())).toBe(true);
  });

  it("calls onEnded when a sound ends, not when it's stopped", async () => {
    const ended = vi.fn();
    const cut = vi.fn();
    const queue = new AudioQueue();

    await queue.enqueue(bytes(), { onEnded: ended });
    tone.players[0].finish();
    expect(ended).toHaveBeenCalledOnce();

    await queue.enqueue(bytes(), { onEnded: cut });
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

  it("keeps a sound's own speed and pitch in range", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ gapTime: 0 });

    await queue.enqueue(bytes(), { speed: 0, pitch: 9 });
    await queue.enqueue(bytes());

    expect(tone.players[0].playbackRate).toBe(0.5);
    expect(tone.players[0].detune).toBe(1200);
    // Its place lasts the slowed down sound
    expect(tone.players[1].startedAt).toBe(14);
  });

  it("changes playing sounds, except the ones with their own speed and pitch", async () => {
    const queue = new AudioQueue();
    await queue.enqueue(bytes());
    await queue.enqueue(bytes(), { speed: 1.5 });
    const [shared, own] = tone.players;

    queue.setFilters({ speed: 0.8, pitch: 2 });

    expect(shared.playbackRate).toBe(0.8);
    expect(shared.detune).toBe(1200);
    expect(own.playbackRate).toBe(1.5);
    expect(own.detune).toBe(0);
  });

  it("sets the volume of playing sounds by key", async () => {
    const queue = new AudioQueue();
    await queue.enqueue(bytes(), { key: "one" });
    const one = tone.gains.at(-1)!;
    await queue.enqueue(bytes(), { key: "two", gain: 0.5 });
    const two = tone.gains.at(-1)!;

    queue.setItemGain("one", 0.2);
    queue.setItemGain("other", 0.9);

    expect(one.gain.value).toBe(0.2);
    expect(two.gain.value).toBe(0.5);
  });

  it("decodes a sound once for all its copies, on every queue", async () => {
    const alerts = new AudioQueue();
    const other = new AudioQueue();
    const decoded = held();

    const copies = [
      alerts.enqueue(bytes(), { cacheKey: "once.mp3" }),
      alerts.enqueue(bytes(), { cacheKey: "once.mp3" }),
    ];
    decoded();
    await Promise.all(copies);
    await other.enqueue(bytes(), { cacheKey: "once.mp3" });

    expect(tone.decode).toHaveBeenCalledOnce();
    expect(tone.players).toHaveLength(3);
    expect(new Set(tone.players.map((p) => p.url)).size).toBe(1);

    // Another sound, or one without a key, is decoded
    await alerts.enqueue(bytes(), { cacheKey: "twice.mp3" });
    await alerts.enqueue(bytes());
    await alerts.enqueue(bytes());
    expect(tone.decode).toHaveBeenCalledTimes(4);
  });

  it("decodes a sound again after a failed decode", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tone.decode.mockRejectedValueOnce(new Error("Unable to decode"));
    const queue = new AudioQueue();

    expect(await queue.enqueue(bytes(), { cacheKey: "retry.mp3" })).toBe(false);
    expect(await queue.enqueue(bytes(), { cacheKey: "retry.mp3" })).toBe(true);
    expect(tone.decode).toHaveBeenCalledTimes(2);
  });

  it("decodes a forgotten sound again, and plays the copies it gave", async () => {
    const queue = new AudioQueue();

    await queue.enqueue(bytes(), { cacheKey: "tts:forget" });
    forgetDecoded("tts:forget");
    forgetDecoded("tts:never-decoded");
    await queue.enqueue(bytes(), { cacheKey: "tts:forget" });

    expect(tone.decode).toHaveBeenCalledTimes(2);
    expect(tone.players.every((p) => !p.disposed)).toBe(true);
  });

  it("forgets a sound still decoding, without counting its bytes", async () => {
    // Two of them don't fit, so a forgotten one counted would push out the next
    const big = () => audio(DECODED_CACHE_BYTES * 0.6);
    tone.decode.mockImplementation(async () => big());
    let decoded!: () => void;
    tone.decode.mockReturnValueOnce(
      new Promise((resolve) => {
        decoded = () => resolve(big());
      }),
    );
    const queue = new AudioQueue();

    const pending = queue.enqueue(bytes(), { cacheKey: "tts:held" });
    forgetDecoded("tts:held");
    decoded();
    await pending;
    await queue.enqueue(bytes(), { cacheKey: "forget-a" });
    await queue.enqueue(bytes(), { cacheKey: "forget-a" });

    expect(tone.decode).toHaveBeenCalledTimes(2);
    // Leaves the shared cache to the other tests
    forgetDecoded("forget-a");
  });

  it("keeps the most recently used decoded sounds that fit", async () => {
    // Two fit, so a third pushes out the least recently used one.
    tone.decode.mockImplementation(async () =>
      audio(DECODED_CACHE_BYTES * 0.4),
    );
    const queue = new AudioQueue();
    const play = (cacheKey: string) => queue.enqueue(bytes(), { cacheKey });

    await play("lru-a");
    await play("lru-b");
    await play("lru-a");
    await play("lru-c");
    expect(tone.decode).toHaveBeenCalledTimes(3);

    await play("lru-a");
    await play("lru-c");
    expect(tone.decode).toHaveBeenCalledTimes(3);
    await play("lru-b");
    expect(tone.decode).toHaveBeenCalledTimes(4);
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

  it("plays a cut's part, faded out at its end, for as long as it lasts", async () => {
    const queue = new AudioQueue();
    queue.setQueueOptions({ gapTime: 0.5 });
    const onScheduled = vi.fn();

    await queue.enqueue(bytes(), { start: 0.5, end: 1.5, onScheduled });
    await queue.enqueue(bytes(), { start: 0.5, speed: 2 });
    await queue.enqueue(bytes());

    const [cut, toEnd] = tone.players;
    expect([cut.offset, cut.length]).toEqual([0.5, 1]);
    // To the sound's end at twice the speed
    expect([toEnd.offset, toEnd.length]).toEqual([0.5, undefined]);
    expect(tone.players.map((p) => p.startedAt)).toEqual([10, 11.5, 12.75]);
    expect(onScheduled).toHaveBeenCalledWith(0.25, 1);

    // Only the cut end fades, on its own node
    const fades = tone.gains.filter((g) => g.gain.scheduled.length > 0);
    expect(fades).toHaveLength(1);
    expect(fades[0].gain.scheduled).toEqual([
      [1, 11 - CUT_FADE],
      [0, 11],
    ]);
    cut.finish();
    expect(fades[0].disposed).toBe(true);
  });

  it("plays a cut that doesn't fit the sound whole", async () => {
    const queue = new AudioQueue();

    await queue.enqueue(bytes(), { start: 3, end: 5 });
    await queue.enqueue(bytes(), { start: 1.5, end: 1 });
    await queue.enqueue(bytes(), { end: 9 });

    expect(tone.players.map((p) => [p.offset, p.length])).toEqual([
      [0, undefined],
      [0, undefined],
      [0, undefined],
    ]);
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
