import { Alert } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { createAlert } from "@/pages/Alerts/helper";
import { alertMedia, failure, mediaFile } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaPicker, MediaThumbnail } from ".";

const CLIP = { name: "Clip", file: "clip.webm" };
const LIBRARY = [mediaFile("Party"), mediaFile("Confetti"), CLIP];

const alert = (patch: Partial<Alert> = {}): Alert => ({
  ...createAlert(),
  id: "alert-1",
  ...patch,
});

function setup(item = alert()) {
  let requests = 0;
  const handlers = {
    onRequest: vi.fn(() => ++requests),
    onSelect: vi.fn(),
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
    // A video shows its first frame, from a URL of its own
    expect(dialog.querySelector("video")?.getAttribute("src")).toMatch(
      /^tokio-media:\/\/\/clip\.webm\?player=.+#t=0\.1$/,
    );
  });

  // Chromium fails the players that load one tokio-media: URL at once.
  it("gives each player of a video its own URL", () => {
    const { container } = renderWithProviders(
      <>
        <MediaThumbnail file="clip.webm" />
        <MediaThumbnail file="clip.webm" />
      </>,
    );

    const [one, two] = [...container.querySelectorAll("video")].map((v) =>
      v.getAttribute("src"),
    );
    expect(one).not.toBe(two);
  });

  it("marks the alert's media", async () => {
    setup(alert({ media: alertMedia(LIBRARY[1]) }));
    await library();

    expect(screen.getByRole("button", { current: true })).toHaveAccessibleName(
      "Confetti",
    );
  });

  it("picks a file", async () => {
    const { user, onSelect } = setup();
    await library();

    await user.click(screen.getByRole("button", { name: "Party" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(LIBRARY[0]);
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
    expect(sent(APP_EVENTS.IMPORT_MEDIA)).toEqual([
      { id: "alert-1", request: 1 },
    ]);
  });

  it("says when main couldn't save this alert's file", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Browse file..." }));

    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      ...failure(),
      id: "alert-2",
      request: 1,
    });
    expect(screen.queryByText(/Couldn't save/)).toBeNull();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      ...failure(),
      id: "alert-1",
      request: 1,
    });
    expect(
      screen.getByText("Couldn't save or load the media."),
    ).toBeInTheDocument();
  });

  it("shows only the failure of the newest request", async () => {
    const { user } = setup();
    const browse = screen.getByRole("button", { name: "Browse file..." });
    await user.click(browse);
    await user.click(browse);

    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      ...failure(),
      id: "alert-1",
      request: 1,
    });
    expect(screen.queryByText(/Couldn't save/)).toBeNull();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      ...failure(),
      id: "alert-1",
      request: 2,
    });
    expect(
      screen.getByText("Couldn't save or load the media."),
    ).toBeInTheDocument();
  });

  it("takes the alert's media off it, and keeps the file", async () => {
    const { user, onSelect } = setup(alert({ media: alertMedia("Party") }));

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([]);
  });

  it("has nothing to clear without media", () => {
    setup();

    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("shows each video's length", async () => {
    setup();
    await library();

    const video = screen
      .getByRole("dialog")
      .querySelector<HTMLVideoElement>(`video[src^="tokio-media:///clip"]`)!;
    Object.defineProperty(video, "duration", { value: 12.3 });
    fireEvent.loadedMetadata(video);

    expect(
      screen.getByRole("button", { name: "Clip 12s" }),
    ).toBeInTheDocument();
  });

  it("closes with Cancel", async () => {
    const { user, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
