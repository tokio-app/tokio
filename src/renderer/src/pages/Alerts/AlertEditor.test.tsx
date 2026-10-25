import { Alert } from "@/common/schemas";
import { alertMedia, mediaFile } from "@test/fixtures";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, Mock, vi } from "vitest";
import { AlertEditor } from "./AlertEditor";
import { createAlert } from "./helper";

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
  await view.user.click(screen.getByRole("tab", { name: "Media" }));
  const rerender = (changed: Alert) =>
    view.rerender(<AlertEditor alert={changed} {...props} />);
  return { ...view, ...props, rerender };
}

// The media's thumbnail read the video's length
const measure = (seconds: number) => {
  const video = screen.getByRole("dialog").querySelector("video")!;
  Object.defineProperty(video, "duration", {
    value: seconds,
    configurable: true,
  });
  fireEvent.loadedMetadata(video);
};
const matched = () => screen.getByRole("checkbox", { name: "Match video" });
const seconds = () =>
  screen.getByRole("spinbutton", { name: "Duration in seconds" });
// The media the editor last set on the alert
const lastMedia = (onChange: Mock<(alert: Alert) => void>) =>
  onChange.mock.lastCall?.[0].media;

describe("AlertEditor's media", () => {
  it("asks for media, and gives the overlay's URL without it", async () => {
    const { user, onPickMedia } = await setup(alert());

    expect(screen.queryByRole("spinbutton")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose media..." }));
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

  it("turns Match video on", async () => {
    const { user, onChange } = await setup(alert({ media: alertMedia(CLIP) }));
    measure(12.3);

    expect(matched()).not.toBeChecked();
    await user.click(matched());

    expect(lastMedia(onChange)?.match_video).toBe(true);
  });

  it("follows the video's length, rounded up", async () => {
    const { onChange } = await setup(
      alert({ media: alertMedia(CLIP, { match_video: true }) }),
    );

    measure(12.3);

    expect(lastMedia(onChange)?.duration).toBe(13);
    // The video sets it
    expect(seconds()).toBeDisabled();
  });

  it("follows another video picked after it was matched", async () => {
    const media = alertMedia(CLIP, { duration: 13, match_video: true });
    const { onChange, rerender } = await setup(alert({ media }));
    measure(12.3);
    expect(onChange).not.toHaveBeenCalled();

    rerender(alert({ media: { ...media, ...REEL } }));
    measure(7.2);

    expect(lastMedia(onChange)?.duration).toBe(8);
  });

  it("rounds from the length's tenths, as the preview shows it", async () => {
    const { onChange } = await setup(
      alert({ media: alertMedia(CLIP, { match_video: true }) }),
    );

    measure(6.02);

    expect(screen.getByText("6s")).toBeInTheDocument();
    expect(lastMedia(onChange)?.duration).toBe(6);
  });

  it("stops at the longest duration", async () => {
    const { onChange } = await setup(
      alert({ media: alertMedia(CLIP, { match_video: true }) }),
    );

    measure(95);

    expect(lastMedia(onChange)?.duration).toBe(60);
  });

  // Some recordings don't say how long they are.
  it("can't follow a video of unknown length", async () => {
    const { onChange, unmount } = await setup(
      alert({ media: alertMedia(CLIP) }),
    );
    measure(Infinity);
    expect(matched()).toBeDisabled();
    unmount();

    // Turned on for another video, it can still be turned off.
    await setup(alert({ media: alertMedia(CLIP, { match_video: true }) }));
    measure(Infinity);
    expect(matched()).toBeEnabled();
    expect(seconds()).toBeEnabled();
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
    const video = screen.getByRole("dialog").querySelector("video")!;
    measure(12.3);
    expect(screen.getByText("12s")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play video" }));
    expect(play).toHaveBeenCalledOnce();
    expect(video.volume).toBe(0.4);

    fireEvent.play(video);
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

  it("isn't offered for an image", async () => {
    await setup(
      alert({ media: alertMedia(mediaFile("Party"), { match_video: true }) }),
    );

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(seconds()).toBeEnabled();
  });
});
