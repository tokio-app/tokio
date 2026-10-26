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
  volume: 60,
  start: 0,
  end: null,
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
    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([{ ...airhorn, request: 1 }]);

    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
      filters: { speed: 1.2, pitch: 0.9 },
    });

    expect(queue.enqueue).toHaveBeenCalledWith(data, {
      gain: 0.8,
      key: "alert-1",
      onEnded: expect.any(Function),
      onScheduled: expect.any(Function),
      speed: 1.2,
      pitch: 0.9,
    });
    expect(result.current.testing).toEqual({ id: "alert-1", loading: false });
  });

  it("ends the test when its sound ends", async () => {
    const { result, queue } = setup();
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
    });

    const [, options] = queue.enqueue.mock.calls[0];
    act(() => options?.onEnded?.());

    expect(result.current.testing).toBeNull();
  });

  it("keeps each tested sound's length", async () => {
    const { result, queue } = setup();
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
    });
    expect(result.current.lengths).toEqual({});

    const [, options] = queue.enqueue.mock.calls[0];
    act(() => options?.onScheduled?.(0.1, 2.5));

    expect(result.current.lengths).toEqual({ "alert-1": 2.5 });
  });

  it("stops the test when it's toggled again", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
    });

    expect(result.current.testing).toBeNull();
    expect(queue.stop).toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("replaces a test that's still loading", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(bell));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
    });

    expect(result.current.testing).toEqual({ id: "alert-2", loading: true });
    expect(queue.enqueue).not.toHaveBeenCalled();

    await send(TEST_ALERT, {
      success: true,
      id: "alert-2",
      request: 2,
      data,
      volume: 100,
    });
    expect(queue.enqueue).toHaveBeenCalledOnce();
  });

  it("ignores a late reply to a test toggled off and on again", async () => {
    const { result, queue } = setup();
    const reply = (request: number) =>
      send(TEST_ALERT, {
        success: true,
        id: "alert-1",
        request,
        data,
        volume: 80,
      });

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([
      { ...airhorn, request: 1 },
      { ...airhorn, request: 2 },
    ]);

    await reply(1);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(result.current.testing).toEqual({ id: "alert-1", loading: true });

    await reply(2);
    await reply(1);
    expect(queue.enqueue).toHaveBeenCalledOnce();
    expect(result.current.testing).toEqual({ id: "alert-1", loading: false });
  });

  it("doesn't end the newer test on a late failure", async () => {
    const { result } = setup();

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, {
      ...failure(),
      id: "alert-1",
      request: 1,
      volume: 80,
    });

    expect(result.current.testing).toEqual({ id: "alert-1", loading: true });
  });

  it("doesn't end the newer test when the stopped one's sound finishes decoding", async () => {
    const { result, queue } = setup();
    let decoded!: (queued: boolean) => void;
    queue.enqueue.mockImplementationOnce(
      () => new Promise((resolve) => (decoded = resolve)),
    );
    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
    });

    act(() => result.current.toggle(airhorn));
    act(() => result.current.toggle(airhorn));
    // Stopped, the first sound's decode ends without a place
    await act(async () => decoded(false));

    expect(result.current.testing).toEqual({ id: "alert-1", loading: true });
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 2,
      data,
      volume: 80,
    });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(result.current.testing).toEqual({ id: "alert-1", loading: false });
  });

  it("ends a test whose sound failed or couldn't be queued", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle(airhorn));
    await send(TEST_ALERT, {
      ...failure(),
      id: "alert-1",
      request: 1,
      volume: 80,
    });
    expect(result.current.testing).toBeNull();
    expect(queue.enqueue).not.toHaveBeenCalled();

    queue.enqueue.mockResolvedValueOnce(false);
    act(() => result.current.toggle(bell));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-2",
      request: 2,
      data,
      volume: 100,
    });
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
        volume: 60,
        start: 0,
        end: null,
      },
    ]);
    // The media's place isn't a sound's length.
    expect(result.current.lengths).toEqual({});

    act(() => options?.onEnded?.());
    expect(result.current.testing).toBeNull();
  });

  it("shows a test's media with its sound", async () => {
    const { result, queue } = setup();

    act(() => result.current.toggle({ ...airhorn, media: party }));
    await send(TEST_ALERT, {
      success: true,
      id: "alert-1",
      request: 1,
      data,
      volume: 80,
    });

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
