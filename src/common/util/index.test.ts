import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatError, getOverlayURL, TaskQueue } from "./index";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
};

describe("TaskQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs tasks one at a time, in order", async () => {
    const queue = new TaskQueue();
    const first = deferred();
    const order: string[] = [];

    queue.enqueue(async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    queue.enqueue(() => {
      order.push("b");
    });
    expect(order).toEqual(["a:start"]);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(["a:start", "a:end", "b"]);
  });

  it("waits gapTime seconds between tasks", async () => {
    const queue = new TaskQueue();
    queue.setQueueOptions({ gapTime: 2 });
    const b = vi.fn();

    queue.enqueue(() => {});
    queue.enqueue(b);

    await vi.advanceTimersByTimeAsync(1999);
    expect(b).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(b).toHaveBeenCalledOnce();
  });

  it("drops tasks once maxQueueLength are waiting", () => {
    const queue = new TaskQueue();
    queue.setQueueOptions({ maxQueueLength: 1 });
    const running = deferred();

    // The running task no longer counts as waiting.
    expect(queue.enqueue(() => running.promise)).toBe(true);
    expect(queue.enqueue(() => {})).toBe(true);
    expect(queue.enqueue(() => {})).toBe(false);
    // Callers get false; a warning per drop is noise on a busy LIVE.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("keeps going after a task throws", async () => {
    const queue = new TaskQueue();
    const b = vi.fn();

    queue.enqueue(() => {
      throw new Error("boom");
    });
    queue.enqueue(b);
    await vi.advanceTimersByTimeAsync(0);

    expect(b).toHaveBeenCalledOnce();
  });

  it("stop drops the waiting tasks", async () => {
    const queue = new TaskQueue();
    const running = deferred();
    const b = vi.fn();

    queue.enqueue(() => running.promise);
    queue.enqueue(b);
    queue.stop();
    running.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(b).not.toHaveBeenCalled();
  });

  it("does not run tasks in parallel when restarted after stop", async () => {
    const queue = new TaskQueue();
    const a = deferred();
    const b = deferred();
    let active = 0;
    let maxActive = 0;
    const track = (wait: Promise<void>) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await wait;
      active--;
    };

    // a was running when stop() was called, so it may overlap with b.
    queue.enqueue(() => a.promise);
    queue.stop();
    queue.enqueue(track(b.promise));
    queue.enqueue(track(Promise.resolve()));

    // a's old loop wakes up while b is still running and starts the next task.
    a.resolve();
    await vi.advanceTimersByTimeAsync(0);
    b.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(maxActive).toBe(1);
  });

  it("keeps the gap when restarted after a stop during the gap", async () => {
    const queue = new TaskQueue();
    queue.setQueueOptions({ gapTime: 2 });
    const c = vi.fn();

    queue.enqueue(() => {});
    queue.enqueue(() => {});
    // Stop halfway through the first loop's gap.
    await vi.advanceTimersByTimeAsync(1000);
    queue.stop();
    queue.enqueue(() => {});
    queue.enqueue(c);

    // The old loop's gap ends after 1000ms, it must not pick up c early.
    await vi.advanceTimersByTimeAsync(1999);
    expect(c).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(c).toHaveBeenCalledOnce();
  });
});

describe("formatError", () => {
  it("returns the message of an error", () => {
    expect(formatError(new Error("offline"))).toBe("offline");
  });

  it("falls back to the name of an error without a message", () => {
    expect(formatError(new TypeError())).toBe("TypeError");
  });

  it("follows the cause chain", () => {
    const error = new Error("save failed", {
      cause: new Error("disk full", { cause: "EIO" }),
    });
    expect(formatError(error)).toBe(
      "save failed -- cause: disk full -- cause: EIO",
    );
  });

  it("stops following a cyclic cause chain", () => {
    const error = new Error("loop");
    error.cause = error;
    expect(formatError(error)).toBe(
      "loop -- cause: loop -- cause: loop -- cause: loop",
    );
  });

  it("describes values that are not errors", () => {
    expect(formatError("timeout")).toBe("timeout");
    expect(formatError({ message: "denied", code: 1 })).toBe("denied");
    expect(formatError({ code: 1 })).toBe('{"code":1}');
    expect(formatError(undefined)).toBe("undefined");
    expect(formatError("")).toBe("unknown");
  });
});

describe("getOverlayURL", () => {
  it("points at the overlay folder on the app hostname", () => {
    expect(getOverlayURL("clock")).toBe("http://tokio-app.local:37891/clock/");
  });

  it("encodes the overlay id", () => {
    expect(getOverlayURL("my overlay")).toBe(
      "http://tokio-app.local:37891/my%20overlay/",
    );
  });
});
