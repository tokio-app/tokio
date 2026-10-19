import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { scopeUpdater, useImmerState } from "./useImmerState";

const settings = () => ({
  filters: { speed: 1, pitch: 1 },
  voice: { name: "Aria" },
});

describe("useImmerState", () => {
  it("changes a nested field and keeps what it didn't touch", () => {
    const initial = settings();
    const { result } = renderHook(() => useImmerState(initial));

    act(() =>
      result.current[1]((draft) => {
        draft.filters.speed = 2;
      }),
    );

    const [state] = result.current;
    expect(state.filters).toEqual({ speed: 2, pitch: 1 });
    expect(state).not.toBe(initial);
    expect(state.voice).toBe(initial.voice);
    expect(initial.filters.speed).toBe(1);
  });

  it("replaces the whole value with setState", () => {
    const { result } = renderHook(() => useImmerState(settings));
    const next = { filters: { speed: 2, pitch: 2 }, voice: { name: "Guy" } };

    act(() => result.current[2](next));

    expect(result.current[0]).toBe(next);
  });

  it("keeps the same updater between renders", () => {
    const { result, rerender } = renderHook(() => useImmerState(settings));
    const [, update] = result.current;

    rerender();

    expect(result.current[1]).toBe(update);
  });
});

describe("scopeUpdater", () => {
  it("edits only its own field", () => {
    const { result } = renderHook(() => useImmerState(settings));
    const voice = result.current[0].voice;
    const updateFilters = scopeUpdater(result.current[1], "filters");

    act(() =>
      updateFilters((filters) => {
        filters.pitch = 0.5;
      }),
    );

    expect(result.current[0].filters).toEqual({ speed: 1, pitch: 0.5 });
    expect(result.current[0].voice).toBe(voice);
  });
});
