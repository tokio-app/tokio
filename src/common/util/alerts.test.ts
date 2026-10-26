import { ALERT_TRIGGERS } from "@/common/schemas";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  ALERT_MESSAGE_VARIABLES,
  cutPart,
  formatAlertMessage,
  mediaKind,
} from "./alerts";
import { generateTikTokEventSample } from "./samples";

const user = { username: "Viewer", handle: "viewer", profilePictures: [] };

describe("formatAlertMessage", () => {
  it("fills the event's values", () => {
    const gift = {
      user,
      gift: {
        id: "5655",
        coins: 1,
        repeatEnd: true,
        type: 1,
        name: "Rose",
        comboCount: 3,
        image: "",
      },
    };

    expect(
      formatAlertMessage("{username} ({handle}) sent {count} {gift}", gift),
    ).toBe("Viewer (viewer) sent 3 Rose");
  });

  it("names the song that is playing", () => {
    const songs = [
      { title: "Old", thumbnail: "", playing: false, played: true },
      { title: "Now", thumbnail: "", playing: true, played: false },
    ];

    expect(formatAlertMessage("Playing {song}", songs)).toBe("Playing Now");
  });

  it("leaves variables the event doesn't have", () => {
    expect(
      formatAlertMessage("{username} {gift} {constructor}", { user }),
    ).toBe("Viewer {gift} {constructor}");
    expect(formatAlertMessage("Thanks {username}", undefined)).toBe(
      "Thanks {username}",
    );
  });

  // The picker lists these, so each must be filled for its trigger.
  it.each(ALERT_TRIGGERS)("fills every variable listed for %s", (trigger) => {
    const event = trigger === EMOTE_TRIGGER ? TOKIO_EVENTS.CHAT : trigger;
    const { data } = generateTikTokEventSample(event);
    const message = ALERT_MESSAGE_VARIABLES[trigger]
      .map((name) => `{${name}}`)
      .join(" ");

    expect(formatAlertMessage(message, data)).not.toMatch(/\{\w+\}/);
  });

  it("fills a sample's handle without the @, like a live one", () => {
    const { data } = generateTikTokEventSample(TOKIO_EVENTS.FOLLOW);

    expect(formatAlertMessage("{handle}", data)).not.toMatch(/^@/);
  });
});

describe("mediaKind", () => {
  it("tells images from videos by their extension, in any case", () => {
    expect(mediaKind("a.PNG")).toBe("image");
    expect(mediaKind("a.gif")).toBe("image");
    expect(mediaKind("clip.WebM")).toBe("video");
    expect(mediaKind("clip.mp4")).toBe("video");
  });

  it("knows nothing else", () => {
    for (const file of ["icon.svg", "ding.mp3", "mp4", "", "."]) {
      expect(mediaKind(file)).toBeNull();
    }
  });
});

describe("cutPart", () => {
  it("plays the cut, or the whole length when it doesn't fit", () => {
    expect(cutPart({ start: 1, end: 3 }, 10)).toEqual({ start: 1, stop: 3 });
    expect(cutPart({ start: 1, end: null }, 10)).toEqual({
      start: 1,
      stop: 10,
    });
    expect(cutPart({ start: 1, end: 30 }, 10)).toEqual({ start: 1, stop: 10 });
    expect(cutPart({ start: 12, end: null }, 10)).toEqual({
      start: 0,
      stop: 10,
    });
  });

  it("starts a cut from before the start at the start", () => {
    expect(cutPart({ start: -2, end: 3 }, 10)).toEqual({ start: 0, stop: 3 });
  });
});
