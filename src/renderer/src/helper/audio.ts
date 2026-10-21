import * as Tone from "tone";

interface AudioQueueOptions {
  maxQueueLength?: number;
  gapTime?: number;
}

interface EnqueueOptions {
  // Per item volume, applied on top of the queue volume
  gain?: number;
  // Lets the volume of this item be changed while it waits or plays
  key?: string;
  // Called when the item finishes playing, not when the queue is stopped
  onEnded?: () => void;
  // Per item speed and pitch, used instead of the queue's filters
  speed?: number;
  pitch?: number;
}

interface QueueItem extends EnqueueOptions {
  buffer: Tone.ToneAudioBuffer;
  gain: number;
}

interface ActiveItem {
  player: Tone.GrainPlayer;
  gainNode: Tone.Gain;
  key?: string;
  // Has its own speed and pitch, which setFilters leaves alone
  ownFilters: boolean;
}

export class AudioQueue {
  private gainNode: Tone.Gain;
  private queue: QueueItem[] = [];
  // Scheduled or playing
  private active: ActiveItem[] = [];
  // Bumped by stop(), so audio still decoding from before is dropped
  private generation: number = 0;
  private nextPlayTime: number = 0;
  public isPlaying: boolean = false;
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
    autoplay: boolean = true,
    { gain = 1, key, onEnded, speed, pitch }: EnqueueOptions = {},
  ) {
    if (this.pending() >= this.maxQueueLength) {
      console.warn("AudioQueue: Max queue length reached. Ignoring input.");
      return false;
    }

    const generation = this.generation;

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

      const rawBuffer = await Tone.getContext().decodeAudioData(audioData);
      const toneBuffer = new Tone.ToneAudioBuffer(rawBuffer);

      if (generation !== this.generation) return false;

      if (this.pending() >= this.maxQueueLength) {
        console.warn(
          "AudioQueue: Queue filled up while decoding. Dropping audio.",
        );
        return false;
      }

      this.queue.push({ buffer: toneBuffer, gain, key, onEnded, speed, pitch });

      if (autoplay) {
        this.start();
      } else if (this.isPlaying) {
        this.scheduleNext();
      }

      return true;
    } catch (error) {
      console.error("Failed to decode Tone audio:", error);
      return false;
    }
  }

  start() {
    this.isPlaying = true;
    this.scheduleNext();
  }

  /**
   * Changes the volume of every waiting or playing item with this key.
   */
  setItemGain(key: string, gain: number) {
    this.queue.forEach((item) => {
      if (item.key === key) item.gain = gain;
    });
    this.active.forEach((item) => {
      if (item.key === key) item.gainNode.gain.rampTo(gain, 0.05);
    });
  }

  stop() {
    this.generation++;
    this.isPlaying = false;
    this.queue = [];
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
    return this.queue.length + this.active.length;
  }

  private scheduleNext() {
    if (!this.isPlaying || this.queue.length === 0) return;

    if (this.nextPlayTime < Tone.now()) {
      this.nextPlayTime = Tone.now();
    }

    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      const { buffer, gain, key, onEnded } = next;
      const speed = next.speed ?? this.currentFilters.speed;
      const pitch = next.pitch ?? this.currentFilters.pitch;

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

      const actualDuration = buffer.duration / speed;

      this.nextPlayTime += actualDuration + this.gapTime;
    }
  }
}
