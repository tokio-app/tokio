import type { AudioContextType } from "@/context/audio";
import { AudioQueue } from "@/helper/audio";
import { vi } from "vitest";

/** An AudioQueue that records its calls. `enqueue` and `wait` take the item. */
function fakeQueue() {
  return {
    enqueue: vi.fn<AudioQueue["enqueue"]>(async () => true),
    wait: vi.fn<AudioQueue["wait"]>(async () => true),
    stop: vi.fn<AudioQueue["stop"]>(),
    setFilters: vi.fn<AudioQueue["setFilters"]>(),
    setQueueOptions: vi.fn<AudioQueue["setQueueOptions"]>(),
    setItemGain: vi.fn<AudioQueue["setItemGain"]>(),
  };
}

type FakeQueue = ReturnType<typeof fakeQueue>;

/**
 * The audio context with fake queues, so components never reach Tone.js.
 * `queue(name)` is the queue a component got with getQueue(name).
 */
export function createAudio() {
  const queues = new Map<string, AudioQueue & FakeQueue>();

  const queue = (name: string) => {
    const found = queues.get(name);
    if (found) return found;
    // An AudioQueue without its constructor, which would build Tone nodes
    const created: AudioQueue & FakeQueue = Object.assign(
      Object.create(AudioQueue.prototype),
      fakeQueue(),
    );
    queues.set(name, created);
    return created;
  };

  const value = {
    getQueue: vi.fn<AudioContextType["getQueue"]>(queue),
    stopQueues: vi.fn<AudioContextType["stopQueues"]>(),
    setItemGain: vi.fn<AudioContextType["setItemGain"]>(),
    resumeContext: vi.fn<AudioContextType["resumeContext"]>(async () => {}),
    // A 2 second sound whose samples rise and fall back
    decode: vi.fn<AudioContextType["decode"]>(async () => {
      const samples = Float32Array.from([0, 0.5, 1, 0.5, 0, 0.25, 0.5, 0]);
      return {
        duration: 2,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: samples.length / 2,
        getChannelData: () => samples,
        copyFromChannel: () => {},
        copyToChannel: () => {},
      } satisfies AudioBuffer;
    }),
  } satisfies AudioContextType;

  return { value, queue };
}
