import { SongInfo, TOKIO_EVENTS } from "@/common/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MusicQueue } from "./queue";

const song = (title: string, duration = 1000): SongInfo => ({
  album: "",
  track: "",
  title,
  thumbnail: "",
  duration,
});

const titles = (queue: MusicQueue) => queue.getSongs().map((s) => s.title);
const playing = (queue: MusicQueue) =>
  queue.getSongs().find((s) => s.playing)?.title;

describe("MusicQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays songs in order, each for its duration", async () => {
    const queue = new MusicQueue();
    const a = vi.fn();
    const b = vi.fn();

    queue.enqueue("a", song("a"), a);
    queue.enqueue("b", song("b"), b);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    expect(playing(queue)).toBe("a");

    await vi.advanceTimersByTimeAsync(999);
    expect(b).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(b).toHaveBeenCalledOnce();
    expect(playing(queue)).toBe("b");

    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.getSongs().every((s) => s.played)).toBe(true);
    expect(queue.getQueueState().isPlaying).toBe(false);
  });

  it("stops calling a listener removed with off", async () => {
    const queue = new MusicQueue();
    const listener = vi.fn();
    queue.on(TOKIO_EVENTS.MUSIC_CHANGE, listener);
    queue.off(TOKIO_EVENTS.MUSIC_CHANGE, listener);

    queue.enqueue("a", song("a"), () => {});
    await vi.advanceTimersByTimeAsync(1000);

    expect(listener).not.toHaveBeenCalled();
  });

  it("emits MUSIC_CHANGE with playing and played flags", async () => {
    const queue = new MusicQueue();
    const listener = vi.fn();
    queue.on(TOKIO_EVENTS.MUSIC_CHANGE, listener);

    queue.enqueue("a", song("a"), () => {});
    queue.enqueue("b", song("b"), () => {});
    await vi.advanceTimersByTimeAsync(1000);

    expect(listener).toHaveBeenLastCalledWith([
      { title: "a", thumbnail: "", playing: false, played: true },
      { title: "b", thumbnail: "", playing: true, played: false },
    ]);
  });

  it("keeps playing when a song's action throws, and reports it", async () => {
    const onError = vi.fn();
    const queue = new MusicQueue(Infinity, onError);
    const b = vi.fn();
    const error = new Error("player crashed");

    queue.enqueue("a", song("a"), () => {
      throw error;
    });
    queue.enqueue("b", song("b"), b);
    await vi.advanceTimersByTimeAsync(1000);

    expect(b).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(String), error);
  });

  it("only waits the remaining time of a song that was already playing", async () => {
    const queue = new MusicQueue();
    const b = vi.fn();

    queue.addCurrentlyPlaying("a", song("a", 1000), 600);
    queue.enqueue("b", song("b"), b);

    await vi.advanceTimersByTimeAsync(399);
    expect(b).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(b).toHaveBeenCalledOnce();
  });

  describe("max size", () => {
    it("drops the newest song when there is no history", () => {
      const queue = new MusicQueue(2);
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});
      queue.enqueue("c", song("c"), () => {});

      expect(titles(queue)).toEqual(["a", "b"]);
    });

    it("drops played songs before upcoming ones", async () => {
      const queue = new MusicQueue(2);
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});
      await vi.advanceTimersByTimeAsync(1000);

      queue.enqueue("c", song("c"), () => {});

      expect(titles(queue)).toEqual(["b", "c"]);
      expect(playing(queue)).toBe("b");
    });

    it("trims right away and never goes below 1", () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});

      queue.setMaxSize(0);

      expect(queue.getMaxSize()).toBe(1);
      expect(titles(queue)).toEqual(["a"]);
    });
  });

  describe("revoke", () => {
    it("removes an upcoming song", () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});

      queue.revoke("b");

      expect(titles(queue)).toEqual(["a"]);
    });

    it("never removes the song that is playing", () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});

      queue.revoke("a");
      queue.revoke("missing");

      expect(titles(queue)).toEqual(["a"]);
    });

    it("leaves the songs that already played", async () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});
      queue.enqueue("c", song("c"), () => {});
      await vi.advanceTimersByTimeAsync(1000);

      queue.revoke("a");

      expect(titles(queue)).toEqual(["a", "b", "c"]);
      expect(playing(queue)).toBe("b");
    });

    it("removes a new request for a song that already played", async () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a (first)"), () => {});
      await vi.advanceTimersByTimeAsync(1000);
      queue.enqueue("b", song("b"), () => {});
      queue.enqueue("a", song("a (again)"), () => {});

      queue.revoke("a");

      expect(titles(queue)).toEqual(["a (first)", "b"]);
      expect(playing(queue)).toBe("b");
    });

    it("removes every request still waiting for the song", () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b (first)"), () => {});
      queue.enqueue("c", song("c"), () => {});
      queue.enqueue("b", song("b (again)"), () => {});

      queue.revoke("b");

      expect(titles(queue)).toEqual(["a", "c"]);
    });
  });

  describe("navigation", () => {
    it("skips to the next song without waiting, and plays each once", async () => {
      const queue = new MusicQueue();
      const a = vi.fn();
      const b = vi.fn();
      queue.enqueue("a", song("a", 10_000), a);
      queue.enqueue("b", song("b", 10_000), b);

      await queue.triggerNext();
      expect(b).toHaveBeenCalledOnce();
      expect(playing(queue)).toBe("b");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(a).toHaveBeenCalledOnce();
      expect(b).toHaveBeenCalledOnce();
      expect(queue.getSongs().every((s) => s.played)).toBe(true);
    });

    it("goes back to the previous song", async () => {
      const queue = new MusicQueue();
      const a = vi.fn();
      queue.enqueue("a", song("a"), a);
      queue.enqueue("b", song("b"), () => {});
      await vi.advanceTimersByTimeAsync(1000);

      await queue.triggerPrevious();

      expect(a).toHaveBeenCalledTimes(2);
      expect(playing(queue)).toBe("a");
    });

    it("jumps to a song by id and ignores unknown ids", async () => {
      const queue = new MusicQueue();
      const c = vi.fn();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});
      queue.enqueue("c", song("c"), c);

      queue.triggerById("missing");
      await queue.triggerAt(5);
      expect(playing(queue)).toBe("a");

      queue.triggerById("c");
      await vi.advanceTimersByTimeAsync(0);
      expect(c).toHaveBeenCalledOnce();
      expect(playing(queue)).toBe("c");
    });

    it("clear stops playback and empties the queue", async () => {
      const queue = new MusicQueue();
      const b = vi.fn();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), b);

      queue.clear();
      await vi.advanceTimersByTimeAsync(1000);

      expect(titles(queue)).toEqual([]);
      expect(b).not.toHaveBeenCalled();
    });
  });
});
