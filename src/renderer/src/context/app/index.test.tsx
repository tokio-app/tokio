import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { createAudio } from "@test/audio";
import { send, sent, sentEvents } from "@test/ipc";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider } from ".";
import { AudioContext } from "../audio";

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
    expect(queue.enqueue).toHaveBeenCalledWith(data, true, {
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

      const [, , options] = audio.queue("tts_data").enqueue.mock.calls[0];
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
      filters: { speed: 1.5, pitch: 0.8 },
    });

    const queue = audio.queue("alerts:gift");
    expect(queue.setQueueOptions).toHaveBeenCalledWith({
      maxQueueLength: 3,
      gapTime: 0.2,
    });
    expect(queue.enqueue).toHaveBeenCalledWith(data, true, {
      gain: 0.4,
      key: "alert-1",
      speed: 1.5,
      pitch: 0.8,
    });
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
