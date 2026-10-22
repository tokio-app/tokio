import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave";

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

// A key field, with main holding `saved`
function setup(saved = "") {
  const save = vi.fn();
  const hook = renderHook((props) => useAutosave(props.saved, save), {
    initialProps: { saved },
  });
  const type = (value: string) => act(() => hook.result.current[1](value));
  const value = () => hook.result.current[0];
  return { ...hook, save, type, value };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("starts from what main holds", () => {
    const { value } = setup("saved-key");

    expect(value()).toBe("saved-key");
  });

  it("saves 300ms after the last change, once for quick changes", async () => {
    const { save, type } = setup();

    type("a");
    await wait(200);
    type("ab");
    await wait(299);
    expect(save).not.toHaveBeenCalled();

    await wait(1);
    expect(save.mock.calls).toEqual([["ab"]]);
  });

  it("doesn't save a change undone before it's sent", async () => {
    const { save, type } = setup("key");

    type("key2");
    type("key");
    await wait(1000);

    expect(save).not.toHaveBeenCalled();
  });

  it("keeps what was typed after a save when main sends that save back", async () => {
    const { save, type, value, rerender } = setup();
    type("abc");
    await wait(300);
    type("abcd");

    rerender({ saved: "abc" });
    expect(value()).toBe("abcd");

    await wait(300);
    expect(save.mock.calls).toEqual([["abc"], ["abcd"]]);
  });

  it("starts over from a value main changed, dropping the change waiting", async () => {
    const { save, type, value, rerender } = setup("old");
    type("typed");

    rerender({ saved: "from-main" });
    await wait(1000);

    expect(value()).toBe("from-main");
    expect(save).not.toHaveBeenCalled();
  });

  it("sends a change still waiting when it unmounts", () => {
    const { save, type, unmount } = setup();
    type("pasted-key");

    unmount();

    expect(save.mock.calls).toEqual([["pasted-key"]]);
  });

  // Closing the window doesn't unmount it
  it("sends a change still waiting when the window closes, once", async () => {
    const { save, type } = setup();
    type("pasted-key");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(save.mock.calls).toEqual([["pasted-key"]]);

    await wait(300);
    expect(save).toHaveBeenCalledOnce();
  });
});
