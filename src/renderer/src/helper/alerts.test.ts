import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { createAudio } from "@test/audio";
import { failure } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { describe, expect, it } from "vitest";
import { queueAlert, soundData } from "./alerts";

const data = new Uint8Array([1, 2, 3]);

const media = {
  name: "Party",
  file: "party.gif",
  duration: 5,
  volume: 100,
  start: 0,
  end: null,
};

const fakeQueue = () => createAudio().queue("alerts");

describe("soundData", () => {
  it("resolves on its file's reply, and ignores other files'", async () => {
    let done = false;
    const bytes = soundData("ding.mp3").then((res) => {
      done = true;
      return res;
    });
    expect(sent(APP_EVENTS.GET_SOUND_DATA)).toEqual([{ file: "ding.mp3" }]);

    await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
      success: true,
      file: "other.mp3",
      data: new Uint8Array([9]),
    });
    expect(done).toBe(false);

    await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
      success: true,
      file: "ding.mp3",
      data,
    });
    expect(await bytes).toBe(data);
  });

  it("rejects when main can't read the sound", async () => {
    const rejected = expect(soundData("gone.mp3")).rejects.toThrow(
      "Unable to read.",
    );

    await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
      ...failure("Unable to read."),
      file: "gone.mp3",
    });

    await rejected;
  });
});

describe("queueAlert", () => {
  it("passes a message's bytes", async () => {
    const queue = fakeQueue();

    await queueAlert(queue, { id: "alert-1", data, key: "tts:hi" });

    expect(queue.enqueue).toHaveBeenCalledWith(data, {});
  });

  it("passes what fetches a library sound sent by key", async () => {
    const queue = fakeQueue();

    await queueAlert(queue, { id: "alert-1", key: "ding.mp3", media });

    const [[fetch]] = queue.enqueue.mock.calls;
    if (typeof fetch !== "function") throw new Error("No fetch was passed");
    expect(sent(APP_EVENTS.GET_SOUND_DATA)).toEqual([]);
    void fetch();
    expect(sent(APP_EVENTS.GET_SOUND_DATA)).toEqual([{ file: "ding.mp3" }]);
    expect(queue.wait).not.toHaveBeenCalled();
  });

  it("holds a silent place for media alone", async () => {
    const queue = fakeQueue();

    await queueAlert(queue, { id: "alert-1", media });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.wait).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ minDuration: 5 }),
    );
  });
});
