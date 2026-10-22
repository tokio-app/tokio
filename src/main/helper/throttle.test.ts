import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttle } from "./throttle";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("throttle", () => {
  it("calls at once, then once at the end of the window with the latest arguments", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1]]);

    vi.advanceTimersByTime(99);
    expect(fn).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });

  it("starts a new window after a waiting call", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    throttled(2);
    vi.advanceTimersByTime(100);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1], [2]]);

    vi.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([[1], [2], [3]]);
  });

  it("calls at once again after a quiet window", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    vi.advanceTimersByTime(100);
    throttled(2);

    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it("drops the waiting call when canceled", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn.mock.calls).toEqual([[1]]);

    throttled(3);
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });
});
