import * as Tone from "tone";

interface AudioQueueOptions {
  maxQueueLength?: number;
  gapTime?: number;
}

interface EnqueueOptions {
  // Per item volume, applied on top of the queue volume
  gain?: number;
  // Lets the volume of this item be changed while it plays
  key?: string;
  // Names the sound, so its copies are decoded once and share the buffer
  cacheKey?: string;
  // Called when the item finishes playing, not when the queue is stopped
  onEnded?: () => void;
  // Per item speed and pitch, used instead of the queue's filters
  speed?: number;
  pitch?: number;
}

interface ActiveItem {
  player: Tone.GrainPlayer;
  gainNode: Tone.Gain;
  key?: string;
  // Has its own speed and pitch, which setFilters leaves alone
  ownFilters: boolean;
}

// Bytes of decoded sounds kept for their next copies, by every queue
export const DECODED_CACHE_BYTES = 200 * 1024 * 1024;

// By cache key, least recently used first. A player keeps its own reference
// to the buffer, so one dropped here still plays to its end.
const decoded = new Map<
  string,
  { audio: Promise<AudioBuffer>; bytes: number }
>();
let decodedBytes = 0;

function decode(data: ArrayBuffer, cacheKey?: string): Promise<AudioBuffer> {
  if (cacheKey === undefined) return Tone.getContext().decodeAudioData(data);

  const cached = decoded.get(cacheKey);
  if (cached) {
    decoded.delete(cacheKey);
    decoded.set(cacheKey, cached);
    return cached.audio;
  }

  // Kept while decoding, so copies that come meanwhile wait for this one
  const entry = { audio: Tone.getContext().decodeAudioData(data), bytes: 0 };
  decoded.set(cacheKey, entry);
  entry.audio.then(
    (audio) => {
      if (decoded.get(cacheKey) !== entry) return;
      // 32-bit samples
      entry.bytes = audio.length * audio.numberOfChannels * 4;
      decodedBytes += entry.bytes;
      for (const [key, oldest] of decoded) {
        if (decodedBytes <= DECODED_CACHE_BYTES) break;
        decoded.delete(key);
        decodedBytes -= oldest.bytes;
      }
    },
    () => {
      if (decoded.get(cacheKey) === entry) decoded.delete(cacheKey);
    },
  );
  return entry.audio;
}

export class AudioQueue {
  private gainNode: Tone.Gain;
  // Scheduled or playing
  private active: ActiveItem[] = [];
  // Sounds being decoded, which already hold their place
  private decoding: number = 0;
  // Bumped by stop(), so audio still decoding from before is dropped
  private generation: number = 0;
  private nextPlayTime: number = 0;
  private maxQueueLength: number;
  private gapTime: number;

  private currentFilters = {
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
  };

  constructor() {
    this.gainNode = new Tone.Gain(1.0).toDestination();
    this.maxQueueLength = Infinity;
    this.gapTime = 0;
  }

  setFilters(
    filters: Partial<{ speed: number; pitch: number; volume: number }>,
  ) {
    if (filters.volume !== undefined) {
      this.currentFilters.volume = Math.max(0, Math.min(filters.volume, 4.0));
      this.gainNode.gain.rampTo(this.currentFilters.volume, 0.1);
    }

    if (filters.speed !== undefined) {
      this.currentFilters.speed = Math.max(0.5, Math.min(filters.speed, 2.0));
    }

    if (filters.pitch !== undefined) {
      this.currentFilters.pitch = Math.max(0.5, Math.min(filters.pitch, 2.0));
    }

    this.active.forEach(({ player, ownFilters }) => {
      if (ownFilters) return;
      if (filters.speed !== undefined) {
        player.playbackRate = this.currentFilters.speed;
      }
      if (filters.pitch !== undefined) {
        player.detune = Math.log2(this.currentFilters.pitch) * 1200;
      }
    });
  }

  public setQueueOptions(options: AudioQueueOptions) {
    this.maxQueueLength = options.maxQueueLength ?? Infinity;
    this.gapTime = options.gapTime ?? 0;
  }

  async enqueue(
    input: Uint8Array | ArrayBuffer,
    { cacheKey, ...item }: EnqueueOptions = {},
  ) {
    if (this.pending() >= this.maxQueueLength) {
      console.warn("AudioQueue: Max queue length reached. Ignoring input.");
      return false;
    }

    const generation = this.generation;
    // Held while decoding, so a full queue never decodes
    this.decoding++;

    try {
      let audioData: ArrayBuffer;

      if (
        input instanceof Uint8Array &&
        input.byteOffset === 0 &&
        input.byteLength === input.buffer.byteLength &&
        input.buffer instanceof ArrayBuffer
      ) {
        // IPC hands over a view of its own buffer, so it's decoded without a copy.
        audioData = input.buffer;
      } else if (input instanceof Uint8Array) {
        audioData = input.slice().buffer;
      } else {
        audioData = input;
      }

      const buffer = await decode(audioData, cacheKey);
      if (generation !== this.generation) return false;

      this.schedule(buffer, item);
      return true;
    } catch (error) {
      console.error("Failed to decode Tone audio:", error);
      return false;
    } finally {
      // stop() already gave the places back
      if (generation === this.generation) this.decoding--;
    }
  }

  /**
   * Changes the volume of every scheduled or playing item with this key.
   */
  setItemGain(key: string, gain: number) {
    this.active.forEach((item) => {
      if (item.key === key) item.gainNode.gain.rampTo(gain, 0.05);
    });
  }

  stop() {
    this.generation++;
    this.decoding = 0;
    this.nextPlayTime = 0;

    const active = this.active;
    this.active = [];
    for (const { player, gainNode } of active) {
      player.onstop = () => {};
      try {
        player.stop();
      } catch {}
      try {
        player.dispose();
      } catch {}
      try {
        gainNode.dispose();
      } catch {}
    }

    // Start over with a fresh output, so later audio never goes through
    // nodes that were torn down above.
    const output = this.gainNode;
    this.gainNode = new Tone.Gain(this.currentFilters.volume).toDestination();
    try {
      output.dispose();
    } catch {}
  }

  private pending() {
    return this.active.length + this.decoding;
  }

  // Plays the sound after the ones already scheduled.
  private schedule(buffer: AudioBuffer, next: EnqueueOptions) {
    const { gain = 1, key, onEnded } = next;
    const speed = next.speed ?? this.currentFilters.speed;
    const pitch = next.pitch ?? this.currentFilters.pitch;

    if (this.nextPlayTime < Tone.now()) {
      this.nextPlayTime = Tone.now();
    }

    // Players only read the buffer, which the sound's copies share.
    const player = new Tone.GrainPlayer({
      url: buffer,
      playbackRate: speed,
      detune: Math.log2(pitch) * 1200,
      grainSize: 0.1,
      overlap: 0.05,
    });

    const gainNode = new Tone.Gain(gain).connect(this.gainNode);
    player.connect(gainNode);
    player.start(this.nextPlayTime);
    this.active.push({
      player,
      gainNode,
      key,
      ownFilters: next.speed !== undefined || next.pitch !== undefined,
    });

    player.onstop = () => {
      this.active = this.active.filter((item) => item.player !== player);
      player.dispose();
      gainNode.dispose();
      onEnded?.();
    };

    this.nextPlayTime += buffer.duration / speed + this.gapTime;
  }
}
