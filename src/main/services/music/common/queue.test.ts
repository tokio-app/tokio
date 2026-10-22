import { SongInfo, TOKIO_EVENTS } from "@/common/types";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
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

  it("emits MUSIC_CHANGE once per change, and calls onStart only when a song starts", async () => {
    const onStart = vi.fn();
    const queue = new MusicQueue({ onStart });
    const listener = vi.fn();
    queue.on(TOKIO_EVENTS.MUSIC_CHANGE, listener);

    queue.enqueue("a", song("a"), () => {});
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { title: "a", thumbnail: "", playing: true, played: false },
    ]);

    queue.enqueue("b", song("b"), () => {});
    expect(listener).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledOnce();

    await queue.triggerNext();
    expect(listener).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenLastCalledWith([
      { title: "a", thumbnail: "", playing: false, played: true },
      { title: "b", thumbnail: "", playing: true, played: false },
    ]);
  });

  it("calls onStart only for a song that started and still plays", async () => {
    const onStart = vi.fn();
    const queue = new MusicQueue({ onStart });
    queue.enqueue("a", song("a"), () => {
      throw new Error("player crashed");
    });
    // Skipped while it loads
    queue.enqueue(
      "b",
      song("b", 60_000),
      () => new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    );
    queue.enqueue("c", song("c", 60_000), () => {});

    await queue.triggerNext();
    await vi.advanceTimersByTimeAsync(3000);

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ title: "a", played: true }),
      expect.objectContaining({ title: "b", played: true }),
      expect.objectContaining({ title: "c", playing: true }),
    ]);
  });

  it("keeps playing when a song's action throws, and reports it", async () => {
    const onError = vi.fn();
    const queue = new MusicQueue({ onError });
    const b = vi.fn();
    const error = new Error("player crashed");

    queue.enqueue("a", song("a"), () => {
      throw error;
    });
    queue.enqueue("b", song("b"), b);

    // Right away, without waiting out the song that failed
    expect(b).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(String), error);
  });

  describe("when the player is gone", () => {
    const broken = (): void => {
      throw new Error("Video unavailable.");
    };

    // A played, then the player went away with b, c and d queued
    const outage = () => {
      const onError = vi.fn();
      const queue = new MusicQueue({ onError });
      const changes = vi.fn();
      queue.on(TOKIO_EVENTS.MUSIC_CHANGE, changes);
      const player = { gone: true };
      const actions: Record<string, Mock<() => void>> = {};
      const request = (title: string) => {
        actions[title] = vi.fn(() => {
          if (player.gone) throw new Error("No active devices.");
        });
        queue.enqueue(title, song(title), actions[title]);
      };
      queue.enqueue("a", song("a"), () => {});
      ["b", "c", "d"].forEach(request);
      return { queue, onError, changes, player, actions, request };
    };

    it("stops at the first of two songs in a row that fail, keeping the rest", async () => {
      const { queue, onError, changes, actions } = outage();

      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledTimes(2);
      expect(changes).toHaveBeenLastCalledWith([
        expect.objectContaining({ title: "a", played: true }),
        expect.objectContaining({ title: "b", playing: true }),
        expect.objectContaining({ title: "c", playing: false }),
        expect.objectContaining({ title: "d", playing: false }),
      ]);
      expect(actions.d).not.toHaveBeenCalled();
      expect(titles(queue)).toEqual(["a", "b", "c", "d"]);
      expect(playing(queue)).toBe("b");
      expect(queue.getQueueState().isPlaying).toBe(true);
    });

    it("keeps every song while the player stays gone, and plays them once it's back", async () => {
      const { queue, player, actions, request } = outage();
      await vi.advanceTimersByTimeAsync(1000);

      request("e");
      request("f");
      expect(actions.b).toHaveBeenCalledTimes(3);
      expect(actions.c).toHaveBeenCalledTimes(3);
      expect(actions.d).not.toHaveBeenCalled();
      expect(titles(queue)).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect(playing(queue)).toBe("b");

      player.gone = false;
      request("g");
      expect(playing(queue)).toBe("b");
      await vi.advanceTimersByTimeAsync(1000);
      expect(playing(queue)).toBe("c");
      await vi.advanceTimersByTimeAsync(1000);
      expect(actions.d).toHaveBeenCalledOnce();
    });

    it("skips a single song that fails", async () => {
      const queue = new MusicQueue();
      const c = vi.fn();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), broken);
      queue.enqueue("c", song("c"), c);

      await vi.advanceTimersByTimeAsync(1000);

      expect(c).toHaveBeenCalledOnce();
      expect(playing(queue)).toBe("c");
    });

    it("doesn't count a failure the queue ran out after", async () => {
      const queue = new MusicQueue();
      const c = vi.fn();
      queue.enqueue("a", song("a"), broken);
      await vi.advanceTimersByTimeAsync(60_000);

      queue.enqueue("b", song("b"), broken);
      queue.enqueue("c", song("c"), c);

      expect(c).toHaveBeenCalledOnce();
      expect(playing(queue)).toBe("c");
    });

    it("stays at the song a skip moved to when the one it left fails", async () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), broken);
      // Fails 3 seconds in, like a request to Spotify
      queue.enqueue(
        "c",
        song("c"),
        () =>
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("No active devices.")), 3000),
          ),
      );
      queue.enqueue("d", song("d", 60_000), () => {});
      await vi.advanceTimersByTimeAsync(1000);

      await queue.triggerNext();
      await vi.advanceTimersByTimeAsync(3000);

      expect(playing(queue)).toBe("d");
    });
  });

  it("keeps one song playing when a skip comes while a song loads", async () => {
    const queue = new MusicQueue();
    const started: [string, number][] = [];
    const t0 = Date.now();
    // Starting a song takes 3 seconds, like YouTube's search and click
    const load = (title: string) => async () => {
      started.push([title, (Date.now() - t0) / 1000]);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    };
    for (const title of ["a", "b", "c", "d"]) {
      queue.enqueue(title, song(title, 60_000), load(title));
    }

    await vi.advanceTimersByTimeAsync(1000);
    await queue.triggerNext();
    await vi.advanceTimersByTimeAsync(130_000);

    expect(started).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 64],
      ["d", 127],
    ]);
  });

  it("only waits the remaining time of a song that was already playing", async () => {
    const queue = new MusicQueue();
    const b = vi.fn();

    queue.addCurrentlyPlaying("a", song("a", 1000), 600, () => {});
    queue.enqueue("b", song("b"), b);

    await vi.advanceTimersByTimeAsync(399);
    expect(b).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(b).toHaveBeenCalledOnce();
  });

  describe("remaining", () => {
    // A player playing a song of `length` ms from now, after an ad
    const player = (length: number, adMs = 0) => {
      const end = Date.now() + adMs + length;
      return vi.fn(async (_song: SongInfo) => Math.max(0, end - Date.now()));
    };
    const run = (
      remaining: (song: SongInfo) => Promise<number | null>,
      duration = 10_000,
    ) => {
      const queue = new MusicQueue({ remaining });
      const b = vi.fn();
      queue.enqueue("a", song("a", duration), () => {});
      queue.enqueue("b", song("b"), b);
      return b;
    };

    it("starts the next song as the player's ends, not at the listed time", async () => {
      // Listed as 10 s, rounded up from 9.4 s
      const remaining = player(9_400);
      const b = run(remaining);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(remaining).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(remaining).toHaveBeenCalledWith(song("a", 10_000));

      // 300 ms early, the time the player takes to switch, on a timer set
      // by that one answer
      await vi.advanceTimersByTimeAsync(4_099);
      expect(b).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(b).toHaveBeenCalledOnce();
      expect(remaining).toHaveBeenCalledOnce();
    });

    it("waits for the player when an ad made the song late", async () => {
      const b = run(player(10_000, 15_000));

      await vi.advanceTimersByTimeAsync(24_699);
      expect(b).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(b).toHaveBeenCalledOnce();
    });

    it("asks right away about a song shorter than the check", async () => {
      const b = run(player(2_000), 2_000);

      await vi.advanceTimersByTimeAsync(1_699);
      expect(b).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(b).toHaveBeenCalledOnce();
    });

    it("starts the next song at once when the player moved on", async () => {
      const b = run(async () => 0);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(b).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(b).toHaveBeenCalledOnce();
    });

    it.each([
      ["it can't tell", async () => null],
      ["it fails", () => Promise.reject(new Error("player gone"))],
    ])(
      "plays the next song at the listed end when %s",
      async (_case, remaining) => {
        const b = run(remaining);

        await vi.advanceTimersByTimeAsync(9_999);
        expect(b).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(b).toHaveBeenCalledOnce();
      },
    );

    it("asks the player about a song whose length didn't parse", async () => {
      // Plays 30 s, its listed length unknown
      const remaining = player(30_000);
      const b = run(remaining, 0);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(remaining).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(remaining).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(19_699);
      expect(b).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(b).toHaveBeenCalledOnce();
    });

    it("plays a song of unknown length 15 s when the player can't tell", async () => {
      const b = run(async () => null, 0);

      await vi.advanceTimersByTimeAsync(14_999);
      expect(b).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(b).toHaveBeenCalledOnce();
    });

    it("isn't asked about a song that failed to start", async () => {
      const remaining = vi.fn(async () => 500);
      const queue = new MusicQueue({ remaining });
      queue.enqueue("a", song("a"), () => {
        throw new Error("player crashed");
      });
      await vi.advanceTimersByTimeAsync(1000);

      expect(remaining).not.toHaveBeenCalled();
    });
  });

  describe("max size", () => {
    it("drops the newest song when there is no history", () => {
      const queue = new MusicQueue();
      queue.setMaxSize(2);
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("b", song("b"), () => {});
      queue.enqueue("c", song("c"), () => {});

      expect(titles(queue)).toEqual(["a", "b"]);
    });

    it("drops played songs before upcoming ones", async () => {
      const queue = new MusicQueue();
      queue.setMaxSize(2);
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

    it("matches the request whatever its case, spaces and accents", () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("Café   Song", song("café"), () => {});

      queue.revoke(" cafe song ");

      expect(titles(queue)).toEqual(["a"]);
    });

    it("does nothing without a song", () => {
      const queue = new MusicQueue();
      queue.enqueue("a", song("a"), () => {});
      queue.enqueue("🎵", song("emoji"), () => {});

      queue.revoke("");
      queue.revoke("🎵");

      expect(titles(queue)).toEqual(["a", "emoji"]);
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
