import { Alert } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { createAlert } from "@/pages/Alerts/helper";
import { alertMedia, failure, mediaFile } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaPicker } from ".";

const CLIP = { name: "Clip", file: "clip.webm" };
const LIBRARY = [mediaFile("Party"), mediaFile("Confetti"), CLIP];
const OVERLAY_URL = "http://tokio-app.local:37891/alerts/alert-1/";

const alert = (patch: Partial<Alert> = {}): Alert => ({
  ...createAlert(),
  id: "alert-1",
  ...patch,
});

function setup(item = alert()) {
  const handlers = {
    onRequest: vi.fn(),
    onSelect: vi.fn(),
    onDuration: vi.fn(),
    onMatch: vi.fn(),
    onClose: vi.fn(),
  };
  const view = renderWithProviders(<MediaPicker alert={item} {...handlers} />);
  return { ...view, ...handlers };
}

const library = () =>
  send(APP_EVENTS_RESPONSE.GET_MEDIA, { success: true, data: LIBRARY });

// A file's tile: its thumbnail and name pick it, next to its delete button
const tile = (name: string) =>
  within(screen.getByRole("button", { name }).parentElement!);

describe("MediaPicker", () => {
  it("shows the media library, searched from the title's row", async () => {
    const { user } = setup();
    expect(sent(APP_EVENTS.GET_MEDIA)).toHaveLength(1);
    expect(screen.getByText(/No media yet/)).toBeInTheDocument();

    await library();
    expect(screen.getByRole("button", { name: "Party" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));
    const search = screen.getByPlaceholderText("Search your media...");
    expect(search).toHaveFocus();
    await user.type(search, "conf");
    expect(screen.queryByRole("button", { name: "Party" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Confetti" }),
    ).toBeInTheDocument();

    await user.type(search, "x");
    expect(screen.getByText("No media matches.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.getByRole("button", { name: "Party" })).toBeInTheDocument();
  });

  it("shows a thumbnail of each image and video", async () => {
    setup();
    await library();

    const dialog = screen.getByRole("dialog");
    expect(
      [...dialog.querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toEqual(["tokio-media:///party.png", "tokio-media:///confetti.png"]);
    // A video shows its first frame
    expect(dialog.querySelector("video")?.getAttribute("src")).toBe(
      "tokio-media:///clip.webm#t=0.1",
    );
  });

  it("marks the alert's media", async () => {
    setup(alert({ media: alertMedia(LIBRARY[1]) }));
    await library();

    expect(screen.getByRole("button", { current: true })).toHaveAccessibleName(
      "Confetti",
    );
  });

  it("picks a file, and stays open for its duration and URL", async () => {
    const { user, onSelect } = setup();
    await library();

    await user.click(screen.getByRole("button", { name: "Party" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(LIBRARY[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("deletes a file once you confirm", async () => {
    const { user, onSelect } = setup();
    await library();

    await user.click(tile("Confetti").getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete media?" });
    expect(confirm).toHaveTextContent(
      '"Confetti" will be deleted from your computer and from every alert that shows it, in all your profiles.',
    );
    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([]);

    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([{ file: "confetti.png" }]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("keeps a file when you cancel", async () => {
    const { user } = setup();
    await library();

    await user.click(tile("Party").getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete media?" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );

    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([]);
  });

  it("asks main for a file from the computer", async () => {
    const { user, onRequest } = setup();

    await user.click(screen.getByRole("button", { name: "Browse file..." }));

    expect(onRequest).toHaveBeenCalledOnce();
    expect(sent(APP_EVENTS.IMPORT_MEDIA)).toEqual([{ id: "alert-1" }]);
  });

  it("says when main couldn't save this alert's file", async () => {
    setup();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      ...failure(),
      id: "alert-2",
    });
    expect(screen.queryByText(/Couldn't save/)).toBeNull();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      ...failure(),
      id: "alert-1",
    });
    expect(
      screen.getByText("Couldn't save or load the media."),
    ).toBeInTheDocument();
  });

  it("changes how long the alert's media shows, or clears it", async () => {
    const media = alertMedia("Party");
    const { user, onDuration, onSelect } = setup(alert({ media }));

    const seconds = screen.getByRole("spinbutton", {
      name: "Duration (seconds)",
    });
    expect(seconds).toHaveValue(5);
    await user.clear(seconds);
    await user.type(seconds, "12");
    expect(onDuration).toHaveBeenLastCalledWith(12);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([]);
  });

  it("keeps the duration in view, with nothing to set or clear without media", () => {
    setup();

    const seconds = screen.getByRole("spinbutton", {
      name: "Duration (seconds)",
    });
    expect(seconds).toBeDisabled();
    expect(seconds).toHaveValue(5);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "Match video" })).toBeNull();
  });

  describe("Match video", () => {
    const REEL = { name: "Reel", file: "reel.mp4" };
    // A video's thumbnail read its length
    const measure = (file: string, seconds: number) => {
      const video = screen
        .getByRole("dialog")
        .querySelector<HTMLVideoElement>(
          `video[src^="tokio-media:///${file}"]`,
        )!;
      Object.defineProperty(video, "duration", { value: seconds });
      fireEvent.loadedMetadata(video);
    };
    const matched = () => screen.getByRole("checkbox", { name: "Match video" });
    const seconds = () =>
      screen.getByRole("spinbutton", { name: "Duration (seconds)" });

    it("shows each video's length", async () => {
      setup();
      await library();

      measure(CLIP.file, 12.3);

      expect(
        screen.getByRole("button", { name: "Clip 12s" }),
      ).toBeInTheDocument();
    });

    it("turns on and off", async () => {
      const { user, onMatch } = setup(alert({ media: alertMedia(CLIP) }));
      await library();
      measure(CLIP.file, 12.3);

      expect(matched()).not.toBeChecked();
      await user.click(matched());

      expect(onMatch).toHaveBeenCalledExactlyOnceWith(true);
    });

    it("follows the video's length, rounded up", async () => {
      const { onDuration } = setup(
        alert({ media: alertMedia(CLIP, { match_video: true }) }),
      );
      await library();

      measure(CLIP.file, 12.3);

      expect(onDuration).toHaveBeenCalledExactlyOnceWith(13);
      expect(matched()).toBeChecked();
      // The video sets it
      expect(seconds()).toBeDisabled();
    });

    it("follows another video picked after it was matched", async () => {
      const media = alertMedia(CLIP, { duration: 13, match_video: true });
      const { rerender, onDuration } = setup(alert({ media }));
      await send(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: true,
        data: [...LIBRARY, REEL],
      });
      measure(CLIP.file, 12.3);
      expect(onDuration).not.toHaveBeenCalled();

      rerender(
        <MediaPicker
          alert={alert({ media: { ...media, ...REEL } })}
          onRequest={vi.fn()}
          onSelect={vi.fn()}
          onDuration={onDuration}
          onMatch={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await send(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: true,
        data: [...LIBRARY, REEL],
      });
      measure(REEL.file, 7.2);

      expect(onDuration).toHaveBeenCalledExactlyOnceWith(8);
    });

    it("stops at the longest duration", async () => {
      const { onDuration } = setup(
        alert({ media: alertMedia(CLIP, { match_video: true }) }),
      );
      await library();

      measure(CLIP.file, 95);

      expect(onDuration).toHaveBeenCalledExactlyOnceWith(60);
    });

    // Some recordings don't say how long they are.
    it("can't follow a video of unknown length", async () => {
      const { onDuration, unmount } = setup(alert({ media: alertMedia(CLIP) }));
      await library();
      measure(CLIP.file, Infinity);
      expect(matched()).toBeDisabled();
      unmount();

      // Turned on for another video, it can still be turned off.
      setup(alert({ media: alertMedia(CLIP, { match_video: true }) }));
      await library();
      measure(CLIP.file, Infinity);
      expect(matched()).toBeEnabled();
      expect(seconds()).toBeEnabled();
      expect(onDuration).not.toHaveBeenCalled();
    });

    it("isn't offered for an image", async () => {
      setup(alert({ media: alertMedia(LIBRARY[0], { match_video: true }) }));
      await library();

      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(seconds()).toBeEnabled();
    });
  });

  it("copies the URL of the alert's overlay", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: OVERLAY_URL }));

    expect(await navigator.clipboard.readText()).toBe(OVERLAY_URL);
  });

  it("closes with Done", async () => {
    const { user, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
