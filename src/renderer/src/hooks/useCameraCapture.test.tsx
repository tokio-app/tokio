import { APP_EVENTS, APP_EVENTS_RESPONSE, CameraCapture } from "@/common/types";
import { startCapture } from "@/helper/camera";
import { send, sent } from "@test/ipc";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCameraCapture } from "./useCameraCapture";

vi.mock("@/helper/camera", () => ({ startCapture: vi.fn() }));

const capture = (
  id: string,
  patch: Partial<CameraCapture> = {},
): CameraCapture => ({
  id,
  device: `device-${id}`,
  label: `Cam ${id}`,
  quality: "720p",
  ...patch,
});

const cameras = (...captures: CameraCapture[]) =>
  send(APP_EVENTS_RESPONSE.CAMERAS, { captures });

// Each capture started, by id, and its stop
let stops: Map<string, ReturnType<typeof vi.fn>>;

describe("useCameraCapture", () => {
  beforeEach(() => {
    stops = new Map();
    vi.mocked(startCapture).mockReset();
    vi.mocked(startCapture).mockImplementation((c) => {
      const stop = vi.fn();
      stops.set(c.id, stop);
      return stop;
    });
  });

  it("asks main for the cameras once, StrictMode too", () => {
    renderHook(() => useCameraCapture(), { reactStrictMode: true });

    expect(sent(APP_EVENTS.GET_CAMERAS)).toHaveLength(1);
  });

  it("starts, keeps, restarts and stops captures by id", async () => {
    renderHook(() => useCameraCapture(), { reactStrictMode: true });

    await cameras(capture("a"), capture("b"));
    expect(vi.mocked(startCapture).mock.calls.map(([c]) => c.id)).toEqual([
      "a",
      "b",
    ]);
    const [a, b] = [stops.get("a")!, stops.get("b")!];

    // b at another quality starts over, a stays, c starts
    await cameras(
      capture("a"),
      capture("b", { quality: "1080p" }),
      capture("c"),
    );
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(startCapture).toHaveBeenLastCalledWith(capture("c"));
    expect(startCapture).toHaveBeenCalledWith(
      capture("b", { quality: "1080p" }),
    );
    expect(startCapture).toHaveBeenCalledTimes(4);

    // Gone from the list
    await cameras(capture("c"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(stops.get("b")).toHaveBeenCalledTimes(1);
    expect(stops.get("c")).not.toHaveBeenCalled();
  });

  it("restarts a capture whose camera changed", async () => {
    renderHook(() => useCameraCapture());

    await cameras(capture("a"));
    const first = stops.get("a")!;
    await cameras(capture("a", { device: "other", label: "Other" }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(startCapture).toHaveBeenLastCalledWith(
      capture("a", { device: "other", label: "Other" }),
    );
  });

  it("stops every capture on unmount", async () => {
    const { unmount } = renderHook(() => useCameraCapture());
    await cameras(capture("a"), capture("b"));

    unmount();

    expect(stops.get("a")).toHaveBeenCalledTimes(1);
    expect(stops.get("b")).toHaveBeenCalledTimes(1);
  });
});
