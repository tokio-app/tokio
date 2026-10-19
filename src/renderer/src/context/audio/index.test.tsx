import { useAudio } from "@/hooks/useAudio";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioProvider } from ".";

const mocks = vi.hoisted(() => {
  class FakeQueue {
    stop = vi.fn();
    setItemGain = vi.fn();
    constructor() {
      created.push(this);
    }
  }
  const created: FakeQueue[] = [];
  return { FakeQueue, created, tone: { state: "suspended", start: vi.fn() } };
});

vi.mock("@/helper/audio", () => ({ AudioQueue: mocks.FakeQueue }));

vi.mock("tone", () => ({
  getContext: () => ({ state: mocks.tone.state }),
  start: mocks.tone.start,
}));

const setup = () => renderHook(() => useAudio(), { wrapper: AudioProvider });

beforeEach(() => {
  mocks.created.length = 0;
  mocks.tone.state = "suspended";
  mocks.tone.start.mockClear();
});

describe("AudioProvider", () => {
  it("creates each queue once, on first use", () => {
    const { result } = setup();
    expect(mocks.created).toHaveLength(0);

    const tts = result.current.getQueue("tts_data");

    expect(result.current.getQueue("tts_data")).toBe(tts);
    expect(result.current.getQueue("alerts")).not.toBe(tts);
    expect(mocks.created).toHaveLength(2);
  });

  it("stops only the queues with the prefix", () => {
    const { result } = setup();
    for (const name of ["alerts", "alerts:gift", "alert-test"]) {
      result.current.getQueue(name);
    }
    const [alerts, gifts, test] = mocks.created;

    result.current.stopQueues("alerts");

    expect(alerts.stop).toHaveBeenCalled();
    expect(gifts.stop).toHaveBeenCalled();
    expect(test.stop).not.toHaveBeenCalled();
  });

  it("changes an item's volume on every queue", () => {
    const { result } = setup();
    result.current.getQueue("alerts");
    result.current.getQueue("alert-test");

    result.current.setItemGain("alert-1", 0.5);

    expect(mocks.created).toHaveLength(2);
    for (const queue of mocks.created) {
      expect(queue.setItemGain).toHaveBeenCalledWith("alert-1", 0.5);
    }
  });

  it("starts Tone only when it isn't running", async () => {
    const { result } = setup();

    await act(() => result.current.resumeContext());
    expect(mocks.tone.start).toHaveBeenCalledOnce();

    mocks.tone.state = "running";
    await act(() => result.current.resumeContext());
    expect(mocks.tone.start).toHaveBeenCalledOnce();
  });

  it("is required by useAudio", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useAudio())).toThrow(
      "useAudio must be used within a AudioProvider",
    );
  });
});
