import { Alert } from "@/common/schemas";
import { EMOTE_TRIGGER, Platform, TOKIO_EVENTS } from "@/common/types";
import { PlatformsContext } from "@/context/platforms";
import { alertMedia, mediaFile } from "@test/fixtures";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, Mock, vi } from "vitest";
import { AlertEditor } from "./AlertEditor";
import { createAlert } from "@/common/util";

const CLIP = { name: "Clip", file: "clip.webm" };
const REEL = { name: "Reel", file: "reel.mp4" };
const OVERLAY_URL = "http://tokio-app.local:37891/alerts/alert-1/";

const alert = (patch: Partial<Alert> = {}): Alert => ({
  ...createAlert(),
  id: "alert-1",
  ...patch,
});

// Opens the editor on its Media tab
async function setup(item: Alert) {
  const props = {
    index: 0,
    gifts: [],
    emotes: [],
    testing: null,
    onTest: vi.fn(),
    onChange: vi.fn<(alert: Alert) => void>(),
    onPickSound: vi.fn(),
    onPickMedia: vi.fn(),
    onClose: vi.fn(),
  };
  const view = renderWithProviders(<AlertEditor alert={item} {...props} />);
  await view.user.click(screen.getByRole("tab", { name: "Image or video" }));
  const rerender = (changed: Alert) =>
    view.rerender(<AlertEditor alert={changed} {...props} />);
  return { ...view, ...props, rerender };
}

const preview = () => screen.getByRole("dialog").querySelector("video")!;
// The media's thumbnail read the video's length
const measure = (seconds: number) => {
  const video = preview();
  Object.defineProperty(video, "duration", {
    value: seconds,
    configurable: true,
  });
  fireEvent.loadedMetadata(video);
};
const seconds = () =>
  screen.getByRole("spinbutton", { name: "Duration in seconds" });
// The media the editor last set on the alert
const lastMedia = (onChange: Mock<(alert: Alert) => void>) =>
  onChange.mock.lastCall?.[0].media;

describe("AlertEditor's media", () => {
  it("asks for media, and gives the overlay's URL without it", async () => {
    const { user, onPickMedia } = await setup(alert());

    expect(screen.queryByRole("spinbutton")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose a file..." }));
    expect(onPickMedia).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: OVERLAY_URL }));
    expect(await navigator.clipboard.readText()).toBe(OVERLAY_URL);
  });

  it("changes how long the media shows", async () => {
    const media = alertMedia("Party");
    const { onChange } = await setup(alert({ media }));
    expect(seconds()).toHaveValue(5);

    fireEvent.change(seconds(), { target: { value: "12" } });

    expect(lastMedia(onChange)).toEqual({ ...media, duration: 12 });
  });

  it("shows a video while it plays, without a duration to type", async () => {
    const { onChange } = await setup(alert({ media: alertMedia(CLIP) }));
    // Nothing to type while the preview reads its length
    expect(screen.queryByRole("spinbutton")).toBeNull();

    measure(12.34);

    expect(lastMedia(onChange)?.duration).toBe(12.34);
    expect(
      screen.queryByRole("spinbutton", { name: "Duration in seconds" }),
    ).toBeNull();
  });

  it("follows another video picked", async () => {
    const media = alertMedia(CLIP, { duration: 12.3 });
    const { onChange, rerender } = await setup(alert({ media }));
    measure(12.3);
    expect(onChange).not.toHaveBeenCalled();

    rerender(alert({ media: { ...media, ...REEL } }));
    measure(7.2);

    expect(lastMedia(onChange)?.duration).toBe(7.2);
  });

  it("shows a video at least a second, and at most the longest duration", async () => {
    const { onChange, rerender } = await setup(
      alert({ media: alertMedia(CLIP) }),
    );

    measure(95);
    expect(lastMedia(onChange)?.duration).toBe(60);

    rerender(alert({ media: alertMedia(CLIP, { start: 2, end: 2.4 }) }));
    expect(lastMedia(onChange)?.duration).toBe(1);
  });

  // Some recordings don't say how long they are.
  it("takes a typed duration for a video of unknown length", async () => {
    const { onChange } = await setup(alert({ media: alertMedia(CLIP) }));

    measure(Infinity);

    expect(seconds()).toBeEnabled();
    expect(screen.queryByRole("slider", { name: "Start" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sets the video's own volume, which an image doesn't have", async () => {
    const media = alertMedia(CLIP, { volume: 100 });
    const { onChange, unmount } = await setup(alert({ volume: 30, media }));

    fireEvent.change(screen.getByRole("slider", { name: "Video volume" }), {
      target: { value: "55" },
    });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      volume: 30,
      media: { ...media, volume: 55 },
    });
    unmount();

    await setup(alert({ media: alertMedia(mediaFile("Party")) }));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("plays the video right in its preview, at its volume, with its length", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const { user } = await setup(
      alert({ media: alertMedia(CLIP, { volume: 40 }) }),
    );
    const video = preview();
    measure(12.3);
    expect(screen.getByText("12s")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play video" }));
    expect(play).toHaveBeenCalledOnce();
    expect(video.volume).toBe(0.4);

    fireEvent.playing(video);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    Object.defineProperty(video, "paused", {
      value: false,
      configurable: true,
    });
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it("doesn't cut an image", async () => {
    await setup(alert({ media: alertMedia(mediaFile("Party")) }));

    expect(seconds()).toBeEnabled();
    expect(screen.queryByRole("slider", { name: "Start" })).toBeNull();
  });
});

describe("AlertEditor's video cut", () => {
  it("cuts the video, and shows the frame where it changed", async () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const { onChange, rerender } = await setup(
      alert({ media: alertMedia(CLIP) }),
    );
    measure(12);

    // Shift moves a handle by a second
    fireEvent.keyDown(screen.getByRole("slider", { name: "Start" }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(lastMedia(onChange)).toMatchObject({ start: 1, end: null });
    expect(pause).toHaveBeenCalled();
    expect(preview().currentTime).toBe(1);

    rerender(alert({ media: alertMedia(CLIP, { start: 1 }) }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "End" }), {
      target: { value: "4.5" },
    });
    expect(lastMedia(onChange)).toMatchObject({ start: 1, end: 4.5 });
    expect(preview().currentTime).toBe(4.5);

    rerender(alert({ media: alertMedia(CLIP, { start: 1, end: 4.5 }) }));
    expect(screen.getByText("Plays 3.5s of 12s")).toBeInTheDocument();
    // In the preview's corner, and how long it shows
    expect(screen.getByText("3.5s")).toBeInTheDocument();
    expect(lastMedia(onChange)?.duration).toBe(3.5);
  });

  it("starts the preview at the cut, and Reset cut plays it whole", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { user, onChange } = await setup(
      alert({ media: alertMedia(CLIP, { start: 1, end: 4 }) }),
    );
    measure(12);
    expect(preview().currentTime).toBe(1);

    await user.click(screen.getByRole("button", { name: "Reset cut" }));

    expect(lastMedia(onChange)).toMatchObject({ start: 0, end: null });
    expect(preview().currentTime).toBe(0);
  });

  it("shows the video while its cut plays", async () => {
    const { onChange } = await setup(
      alert({ media: alertMedia(CLIP, { start: 2, end: 8.3 }) }),
    );

    measure(12.3);

    expect(lastMedia(onChange)?.duration).toBe(6.3);
  });

  it("plays the cut in its preview, and pauses at its end", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    await setup(alert({ media: alertMedia(CLIP, { start: 2, end: 4 }) }));
    measure(12);
    const video = preview();
    video.currentTime = 7;

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play video" }));
      expect(video.currentTime).toBe(2);

      Object.defineProperty(video, "paused", {
        value: false,
        configurable: true,
      });
      fireEvent.playing(video);
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

      vi.advanceTimersByTime(2000);
      // Its clock lags behind the timer, so it plays on.
      expect(pause).not.toHaveBeenCalled();
      video.currentTime = 4;
      vi.advanceTimersByTime(2000);
      expect(pause).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AlertEditor's minimum", () => {
  const gift = (patch: Partial<Alert["trigger"]> = {}) =>
    alert({
      trigger: {
        ...createAlert().trigger,
        type: TOKIO_EVENTS.GIFT,
        ...patch,
      },
    });
  const open = (item: Alert, platforms: Platform[]) =>
    renderWithProviders(
      <PlatformsContext value={platforms}>
        <AlertEditor
          alert={item}
          index={0}
          gifts={[]}
          emotes={[]}
          testing={null}
          onTest={vi.fn()}
          onChange={vi.fn()}
          onPickSound={vi.fn()}
          onPickMedia={vi.fn()}
          onClose={vi.fn()}
        />
      </PlatformsContext>,
    );
  const minimum = () => screen.queryByRole("group", { name: "Worth at least" });

  // The streak's note only where gifts come in streaks, TikTok's: YouTube's
  // come whole
  it.each([
    [["tiktok"], {}, "coins", true],
    // Kick sends no gifts
    [["tiktok", "kick"], {}, "coins", true],
    [["tiktok", "youtube"], { platform: "tiktok" }, "coins", true],
    [["tiktok", "youtube"], {}, "coins or Jewels", true],
    [["youtube"], {}, "Jewels", false],
    [["tiktok", "youtube"], { platform: "youtube" }, "Jewels", false],
    // A minimum saved on a row with no gifts stays to fix
    [["kick"], { min_coins: 10 }, "coins", false],
  ] as const)(
    "names it for %j and %j in %s, the note %s",
    (platforms, patch, unit, note) => {
      open(gift(patch), [...platforms]);

      expect(minimum()).toHaveTextContent(
        new RegExp(`^Worth at least ${unit}${note ? "The" : "$"}`),
      );
      expect(
        screen.getByRole("spinbutton", { name: "Worth at least" }),
      ).toBeInTheDocument();
    },
  );

  it("has none for a row with no gifts", () => {
    open(gift(), ["kick"]);

    expect(minimum()).toBeNull();
  });

  it.each([
    [TOKIO_EVENTS.CHEER, "Worth at least", "Bits"],
    [TOKIO_EVENTS.KICKS, "Worth at least", "Kicks"],
    [TOKIO_EVENTS.SUPER_CHAT, "Worth at least", "USD"],
    [TOKIO_EVENTS.GIFT_SUB, "At least", "gifted subs"],
  ] as const)("takes %s's in its own unit", (type, label, unit) => {
    open(gift({ type }), ["twitch", "youtube", "kick"]);

    expect(screen.getByRole("group", { name: label })).toHaveTextContent(
      new RegExp(`^${label} ${unit}$`),
    );
    expect(screen.getByRole("spinbutton", { name: label })).toBeInTheDocument();
  });

  it("has none for events without money", () => {
    open(gift({ type: TOKIO_EVENTS.FOLLOW }), ["twitch"]);

    expect(minimum()).toBeNull();
    expect(screen.queryByRole("group", { name: "At least" })).toBeNull();
  });
});

describe("AlertEditor's rows on their platforms", () => {
  const ALL: Platform[] = ["tiktok", "twitch", "youtube", "kick"];
  const row = (patch: Partial<Alert["trigger"]>) =>
    alert({ trigger: { ...createAlert().trigger, ...patch } });
  const open = (item: Alert, platforms: Platform[]) =>
    renderWithProviders(
      <PlatformsContext value={platforms}>
        <AlertEditor
          alert={item}
          index={0}
          gifts={[]}
          emotes={[]}
          testing={null}
          onTest={vi.fn()}
          onChange={vi.fn()}
          onPickSound={vi.fn()}
          onPickMedia={vi.fn()}
          onClose={vi.fn()}
        />
      </PlatformsContext>,
    );
  // The From field's checkboxes, by name, and whether each is checked
  const roles = () => {
    const from = screen.queryByRole("group", { name: "From" });
    return from
      ? within(from)
          .getAllByRole("checkbox")
          .map((box) => [
            box.closest("label")?.textContent,
            box instanceof HTMLInputElement && box.checked,
          ])
      : null;
  };

  it("offers the roles the row's platforms say, as they call them", () => {
    const { unmount } = open(
      row({ type: TOKIO_EVENTS.CHAT, platform: "tiktok" }),
      ALL,
    );
    expect(roles()).toEqual([
      ["Followers", false],
      ["Moderators", false],
      ["Super Fans", false],
    ]);
    unmount();

    // Twitch never says who follows, its Super Fans are subscribers, and it
    // has VIPs
    const twitch = open(
      row({ type: TOKIO_EVENTS.CHAT, platform: "twitch" }),
      ALL,
    );
    expect(roles()).toEqual([
      ["Moderators", false],
      ["Subscribers", false],
      ["VIPs", false],
    ]);
    twitch.unmount();

    const youtube = open(
      row({ type: EMOTE_TRIGGER, platform: "youtube" }),
      ALL,
    );
    expect(roles()).toEqual([
      ["Moderators", false],
      ["Members", false],
    ]);
    youtube.unmount();

    // Any platform names each
    open(row({ type: TOKIO_EVENTS.CHAT }), ALL);
    expect(roles()).toEqual([
      ["Followers", false],
      ["Moderators", false],
      ["Super Fans, subscribers, and members", false],
      ["VIPs", false],
    ]);
  });

  it("keeps a role saved before, to clear it", () => {
    open(
      row({ type: TOKIO_EVENTS.CHAT, platform: "kick", roles: ["follower"] }),
      ALL,
    );

    expect(roles()).toEqual([
      ["Followers", true],
      ["Moderators", false],
      ["Subscribers", false],
      ["VIPs", false],
    ]);
  });

  it("has no roles or gift filter on a Kicks row, and a minimum", () => {
    open(row({ type: TOKIO_EVENTS.KICKS, platform: "kick" }), ALL);

    // Kicks come without badges
    expect(roles()).toBeNull();
    expect(screen.queryByRole("group", { name: "Gifts" })).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Worth at least" }),
    ).toBeInTheDocument();
  });
});
