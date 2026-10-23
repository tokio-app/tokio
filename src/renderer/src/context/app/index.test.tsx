import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { forgetDecoded } from "@/helper/audio";
import { createAudio } from "@test/audio";
import { send, sent, sentEvents } from "@test/ipc";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider } from ".";
import { AudioContext } from "../audio";

vi.mock("@/helper/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helper/audio")>()),
  forgetDecoded: vi.fn(),
}));

const data = new Uint8Array([1, 2, 3]);

function setup() {
  const audio = createAudio();
  render(
    <AudioContext.Provider value={audio.value}>
      <AppProvider>
        <p>Loaded</p>
      </AppProvider>
    </AudioContext.Provider>,
  );
  return audio;
}

describe("AppProvider", () => {
  it("waits for main to load, then asks to show the window", async () => {
    setup();

    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
    expect(sent(APP_EVENTS.LOAD_APP)).toHaveLength(1);
    expect(sentEvents()).not.toContain(APP_EVENTS.SHOW_WINDOW);

    await send(APP_EVENTS_RESPONSE.LOAD_APP, { success: true });

    expect(screen.getByText("Loaded")).toBeInTheDocument();
    expect(sent(APP_EVENTS.SHOW_WINDOW)).toHaveLength(1);
  });

  it("shows only the title bar and a message when main couldn't start", async () => {
    setup();

    await send(APP_EVENTS_RESPONSE.LOAD_APP, { success: false });

    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Tokio couldn't start. Check the logs folder for details.",
      ),
    ).toBeInTheDocument();
    for (const name of ["Minimize", "Maximize", "Close"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(sent(APP_EVENTS.SHOW_WINDOW)).toHaveLength(1);
  });

  it("plays TTS on its queue, with the volume as a fraction and its own speed", async () => {
    const audio = setup();

    await send(APP_EVENTS_RESPONSE.TTS_AUDIO, {
      id: 1,
      data,
      filters: { speed: 1.2, pitch: 0.9, volume: 50 },
      queueOptions: { gapTime: 1, maxQueueLength: 5 },
    });

    const queue = audio.queue("tts_data");
    expect(queue.setQueueOptions).toHaveBeenCalledWith({
      gapTime: 1,
      maxQueueLength: 5,
    });
    expect(queue.setFilters).toHaveBeenCalledExactlyOnceWith({ volume: 0.5 });
    expect(queue.enqueue).toHaveBeenCalledWith(data, {
      speed: 1.2,
      pitch: 0.9,
      onEnded: expect.any(Function),
    });
  });

  describe("tells main when a TTS message is done", () => {
    const tts = {
      id: 7,
      data,
      filters: { speed: 1, pitch: 1, volume: 100 },
      queueOptions: { gapTime: 0, maxQueueLength: 5 },
    };

    it("once it has played", async () => {
      const audio = setup();
      await send(APP_EVENTS_RESPONSE.TTS_AUDIO, tts);

      expect(sent(APP_EVENTS.TTS_PLAYED)).toEqual([]);

      const [, options] = audio.queue("tts_data").enqueue.mock.calls[0];
      options?.onEnded?.();

      expect(sent(APP_EVENTS.TTS_PLAYED)).toEqual([{ id: 7 }]);
    });

    it("when the queue drops it", async () => {
      const audio = setup();
      audio.queue("tts_data").enqueue.mockResolvedValue(false);

      await send(APP_EVENTS_RESPONSE.TTS_AUDIO, tts);

      await vi.waitFor(() =>
        expect(sent(APP_EVENTS.TTS_PLAYED)).toEqual([{ id: 7 }]),
      );
    });
  });

  it("plays alerts on their channel, with their own volume and filters", async () => {
    const audio = setup();

    await send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
      data,
      volume: 40,
      channel: "alerts:gift",
      maxQueueLength: 3,
      id: "alert-1",
      key: "airhorn.mp3",
      filters: { speed: 1.5, pitch: 0.8 },
    });

    const queue = audio.queue("alerts:gift");
    expect(queue.setQueueOptions).toHaveBeenCalledWith({
      maxQueueLength: 3,
      gapTime: 0.2,
    });
    // Copies of the sound share one decoded buffer
    expect(queue.enqueue).toHaveBeenCalledWith(data, {
      gain: 0.4,
      key: "alert-1",
      cacheKey: "airhorn.mp3",
      speed: 1.5,
      pitch: 0.8,
    });
  });

  it("queues the copies main asks for, sharing one decode", async () => {
    const audio = setup();
    vi.mocked(forgetDecoded).mockClear();

    await send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
      data,
      volume: 40,
      channel: "alerts",
      maxQueueLength: 5,
      id: "alert-1",
      key: "airhorn.mp3",
      repeat: 3,
    });

    const { calls } = audio.queue("alerts").enqueue.mock;
    expect(calls).toHaveLength(3);
    for (const [bytes, options] of calls) {
      expect(bytes).toBe(data);
      expect(options).toMatchObject({ cacheKey: "airhorn.mp3" });
    }
    // Sounds stay decoded for their next alerts
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forgetDecoded).not.toHaveBeenCalled();
  });

  it("forgets a message's decode once its copies have their places", async () => {
    const audio = setup();
    const queue = audio.queue("alerts");
    let placed!: (queued: boolean) => void;
    queue.enqueue.mockReturnValueOnce(
      new Promise((resolve) => {
        placed = resolve;
      }),
    );
    vi.mocked(forgetDecoded).mockClear();

    await send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
      data,
      volume: 40,
      channel: "alerts",
      maxQueueLength: 5,
      id: "alert-1",
      key: "tts:thanks",
      repeat: 2,
    });

    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(forgetDecoded).not.toHaveBeenCalled();

    placed(true);
    await vi.waitFor(() =>
      expect(forgetDecoded).toHaveBeenCalledExactlyOnceWith("tts:thanks"),
    );
  });

  it("shows an alert's media on its overlay when the alert's turn comes", async () => {
    const audio = setup();
    const media = {
      name: "Party",
      file: "party.gif",
      duration: 5,
      match_video: false,
    };

    await send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
      data,
      volume: 40,
      channel: "alerts",
      maxQueueLength: 3,
      id: "alert-1",
      key: "ding.mp3",
      media,
    });

    // The sound holds its place for the media's duration at least.
    const [, options] = audio.queue("alerts").enqueue.mock.calls[0];
    expect(options).toMatchObject({ key: "alert-1", minDuration: 5 });
    expect(sent(APP_EVENTS.SHOW_ALERT_MEDIA)).toEqual([]);

    options?.onScheduled?.(1.5, 6);
    expect(sent(APP_EVENTS.SHOW_ALERT_MEDIA)).toEqual([
      { id: "alert-1", file: "party.gif", delay: 1.5, duration: 6, volume: 40 },
    ]);
  });

  it("holds a silent place for an alert that only shows media", async () => {
    const audio = setup();

    await send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
      volume: 40,
      channel: "alerts",
      maxQueueLength: 3,
      id: "alert-1",
      media: {
        name: "Party",
        file: "party.gif",
        duration: 5,
        match_video: false,
      },
    });

    const queue = audio.queue("alerts");
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.wait).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ key: "alert-1", minDuration: 5 }),
    );
  });

  it("stops the TTS queue when main clears it", async () => {
    const audio = setup();

    await send(APP_EVENTS_RESPONSE.TTS_CLEAR);

    expect(audio.value.stopQueues).toHaveBeenCalledExactlyOnceWith("tts_data");
  });

  it("stops every alert queue when main clears them", async () => {
    const audio = setup();

    await send(APP_EVENTS_RESPONSE.ALERT_CLEAR);

    expect(audio.value.stopQueues).toHaveBeenCalledWith("alerts");
  });
});
