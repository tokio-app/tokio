import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure } from "@test/fixtures";
import { listeners, send, sent } from "@test/ipc";
import { providers } from "@test/render";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAlertTest } from "./useAlertTest";

const { TEST_ALERT } = APP_EVENTS_RESPONSE;

const airhorn = { id: "alert-1", file: "airhorn.mp3", volume: 80 };
const bell = { id: "alert-2", file: "bell.mp3", volume: 100 };
const data = new Uint8Array([1, 2, 3]);
const party = {
  name: "Party",
  file: "party.gif",
  duration: 5,
  match_video: false,
};

function setup() {
  const { wrapper, audio } = providers();
  const hook = renderHook(() => useAlertTest(), { wrapper });
  return { ...hook, queue: audio.queue("alert-test") };
}

describe("useAlertTest", () => {
  it("loads a test until its sound is queued", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    expect(result.current.testing).toEqual({ id: "alert-1", loading: true });
    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([airhorn]);

    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      data,
      volume: 80,
      filters: { speed: 1.2, pitch: 0.9 },
    });

    expect(queue.enqueue).toHaveBeenCalledWith(data, {
      gain: 0.8,
      key: "alert-1",
      onEnded: expect.any(Function),
      speed: 1.2,
      pitch: 0.9,
    });
    expect(result.current.testing).toEqual({ id: "alert-1", loading: false });
  });

  it("ends the test when its sound ends", async () => {
    const { result, queue } = setup();
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, { success: true, id: "alert-1", data, volume: 80 });

    const [, options] = queue.enqueue.mock.calls[0];
    act(() => options?.onEnded?.());

    expect(result.current.testing).toBeNull();
  });

  it("stops the test when it's toggled again", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, { success: true, id: "alert-1", data, volume: 80 });

    expect(result.current.testing).toBeNull();
    expect(queue.stop).toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("replaces a test that's still loading", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(bell));
    await send(TEST_ALERT, { success: true, id: "alert-1", data, volume: 80 });

    expect(result.current.testing).toEqual({ id: "alert-2", loading: true });
    expect(queue.enqueue).not.toHaveBeenCalled();

    await send(TEST_ALERT, { success: true, id: "alert-2", data, volume: 100 });
    expect(queue.enqueue).toHaveBeenCalledOnce();
  });

  it("ends a test whose sound failed or couldn't be queued", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, { ...failure(), id: "alert-1", volume: 80 });
    expect(result.current.testing).toBeNull();
    expect(queue.enqueue).not.toHaveBeenCalled();

    queue.enqueue.mockResolvedValueOnce(false);
    act(() => result.current.toggle(bell));
    await send(TEST_ALERT, { success: true, id: "alert-2", data, volume: 100 });
    expect(result.current.testing).toBeNull();
  });

  it("tests media alone without main, showing it on the alert's overlay", async () => {
    const { result, queue } = setup();

    await act(async () =>
      result.current.toggle({ id: "alert-1", volume: 80, media: party }),
    );

    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([]);
    expect(queue.wait).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ gain: 0.8, key: "alert-1", minDuration: 5 }),
    );
    expect(result.current.testing).toEqual({ id: "alert-1", loading: false });

    const [, options] = queue.wait.mock.calls[0];
    options?.onScheduled?.(0.25, 5);
    expect(sent(APP_EVENTS.SHOW_ALERT_MEDIA)).toEqual([
      {
        id: "alert-1",
        file: "party.gif",
        delay: 0.25,
        duration: 5,
        volume: 80,
      },
    ]);

    act(() => options?.onEnded?.());
    expect(result.current.testing).toBeNull();
  });

  it("shows a test's media with its sound", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle({ ...airhorn, media: party }));
    await send(TEST_ALERT, { success: true, id: "alert-1", data, volume: 80 });

    expect(queue.enqueue).toHaveBeenCalledWith(
      data,
      expect.objectContaining({
        minDuration: 5,
        onScheduled: expect.any(Function),
      }),
    );
  });

  it("stop() cuts the test", () => {
    const { result, queue } = setup();
    act(() => result.current.toggle(airhorn));

    act(() => result.current.stop());

    expect(result.current.testing).toBeNull();
    expect(queue.stop).toHaveBeenCalled();
  });

  it("stops its sound and stops listening when it unmounts", () => {
    const { unmount, queue } = setup();
    queue.stop.mockClear();
    expect(listeners(TEST_ALERT)).toBe(1);

    unmount();

    expect(queue.stop).toHaveBeenCalled();
    expect(listeners(TEST_ALERT)).toBe(0);
  });
});
