import { AlertSound, MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { intersect } from "@test/dom";
import { alertSound, failure, mediaFile } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp, renderWithProviders } from "@test/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Library } from ".";

const airhorn = alertSound("Airhorn");
const bell = alertSound("Bell");
const party = mediaFile("Party");
const clip = { name: "Clip", file: "clip.webm" };
const data = new Uint8Array([1, 2, 3]);
const soundsFailed = "Some sounds couldn't be added or deleted.";
const mediaFailed = "Some files couldn't be added or deleted.";
const soundsEmpty = "No sounds yet. Add some with the + button.";
const mediaEmpty = "No images or videos yet. Add some with the + button.";

const sounds = (...list: AlertSound[]) =>
  send(APP_EVENTS_RESPONSE.GET_SOUNDS, { success: true, data: list });
const media = (...list: MediaFile[]) =>
  send(APP_EVENTS_RESPONSE.GET_MEDIA, { success: true, data: list });

// A sound's row or a file's tile: its name sits next to its buttons
const row = (name: string) =>
  within(screen.getByTitle(name, { exact: true }).parentElement!);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const names = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent);

// Answers the confirmation of a deletion
const confirmDelete = (title: string) =>
  within(screen.getByRole("dialog", { name: title })).getByRole("button", {
    name: "Delete",
  });

async function setup() {
  const app = renderWithProviders(<Library />);
  await sounds(airhorn, bell);
  await media(party, clip);
  intersect();
  return { ...app, queue: app.audio.queue("alert-test") };
}

async function openMedia() {
  const app = await setup();
  await app.user.click(tab(/^Images and videos/));
  intersect();
  return app;
}

async function search(user: Awaited<ReturnType<typeof setup>>["user"]) {
  await user.click(screen.getByRole("button", { name: "Search" }));
}

describe("Library", () => {
  it("opens at /alerts/library with Alerts active in the sidebar", async () => {
    await renderApp("/alerts/library");

    expect(screen.getByRole("heading", { name: "Library" })).toBeVisible();
    expect(
      within(screen.getByRole("navigation")).getByRole("link", {
        name: "Alerts",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("opens from the Alerts page", async () => {
    const { user, router } = await renderApp("/alerts");

    await user.click(screen.getByRole("button", { name: "Library" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/alerts/library"),
    );
    expect(screen.getByRole("heading", { name: "Library" })).toBeVisible();
  });

  it("goes back to Alerts", async () => {
    const { user, router } = await renderApp("/alerts/library");

    await user.click(screen.getByRole("button", { name: "Back to Alerts" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/alerts"));
  });

  it("asks main for both libraries", () => {
    renderWithProviders(<Library />);

    expect(sent(APP_EVENTS.GET_SOUNDS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_MEDIA)).toHaveLength(1);
  });

  it("counts each library on its tab once main replies", async () => {
    renderWithProviders(<Library />);
    expect(tab(/^Sounds/)).toHaveAccessibleName("Sounds");
    expect(tab(/^Images/)).toHaveAccessibleName("Images and videos");

    await sounds(airhorn, bell);
    await media(party);

    expect(tab(/^Sounds/)).toHaveAccessibleName("Sounds 2");
    expect(tab(/^Images/)).toHaveAccessibleName("Images and videos 1");
    expect(tab(/^Sounds/)).toHaveAttribute("aria-selected", "true");
  });

  describe("sounds", () => {
    it("lists the sounds, newest first", async () => {
      renderWithProviders(<Library />);
      expect(screen.getByText(soundsEmpty)).toBeInTheDocument();

      await sounds(airhorn, bell);

      expect(names()).toEqual(["Bell", "Airhorn"]);
      expect(screen.queryByText(soundsEmpty)).not.toBeInTheDocument();
    });

    it("shows each sound's length", async () => {
      const { container } = await setup();

      const audio = container.querySelector(
        `audio[src="tokio-media:///sounds/${bell.file}"]`,
      )!;
      Object.defineProperty(audio, "duration", { value: 12 });
      fireEvent.loadedMetadata(audio);

      expect(row("Bell").getByText("12s")).toBeInTheDocument();
    });

    it("searches the sounds by name", async () => {
      const { user } = await setup();
      await search(user);

      await user.type(screen.getByPlaceholderText("Search sounds..."), "BEL");
      expect(names()).toEqual(["Bell"]);

      await user.type(screen.getByPlaceholderText("Search sounds..."), "x");
      expect(screen.getByText("No sounds match.")).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });

    it("adds sounds with the + button", async () => {
      const { user } = await setup();

      await user.click(screen.getByRole("button", { name: "Add sounds" }));

      expect(sent(APP_EVENTS.UPLOAD_SOUNDS)).toHaveLength(1);
      expect(sent(APP_EVENTS.UPLOAD_MEDIA)).toEqual([]);
    });

    it("deletes a sound once you confirm", async () => {
      const { user, queue } = await setup();

      await user.click(row("Bell").getByRole("button", { name: "Delete" }));
      expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([]);
      await user.click(confirmDelete("Delete sound?"));

      expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([{ file: "bell.mp3" }]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      // Nothing was playing
      expect(queue.stop).not.toHaveBeenCalled();
    });

    it("tests a sound through main", async () => {
      const { user, queue } = await setup();

      await user.click(row("Airhorn").getByRole("button", { name: "Play" }));
      // Tests are numbered across mounts, so the reply takes the sent number
      const [{ request }] = sent(APP_EVENTS.TEST_ALERT);
      expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([
        { id: "airhorn.mp3", file: "airhorn.mp3", volume: 100, request },
      ]);
      expect(
        row("Airhorn").getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();

      await send(APP_EVENTS_RESPONSE.TEST_ALERT, {
        success: true,
        id: "airhorn.mp3",
        request,
        data,
        volume: 100,
      });

      expect(queue.enqueue).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ gain: 1, key: "airhorn.mp3" }),
      );
      expect(
        row("Airhorn").getByRole("button", { name: "Stop" }),
      ).toBeInTheDocument();
    });

    it("stops a sound's test before removing it", async () => {
      const { user, queue } = await setup();
      await user.click(row("Airhorn").getByRole("button", { name: "Play" }));
      await send(APP_EVENTS_RESPONSE.TEST_ALERT, {
        success: true,
        id: "airhorn.mp3",
        request: sent(APP_EVENTS.TEST_ALERT)[0].request,
        data,
        volume: 100,
      });
      expect(queue.enqueue).toHaveBeenCalled();
      queue.stop.mockClear();

      await user.click(row("Airhorn").getByRole("button", { name: "Delete" }));
      expect(queue.stop).not.toHaveBeenCalled();
      await user.click(confirmDelete("Delete sound?"));

      expect(queue.stop).toHaveBeenCalled();
      expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([{ file: "airhorn.mp3" }]);
      expect(
        row("Airhorn").getByRole("button", { name: "Play" }),
      ).toBeInTheDocument();
    });

    it("keeps another sound's test playing when one is removed", async () => {
      const { user, queue } = await setup();
      await user.click(row("Airhorn").getByRole("button", { name: "Play" }));
      queue.stop.mockClear();

      await user.click(row("Bell").getByRole("button", { name: "Delete" }));
      await user.click(confirmDelete("Delete sound?"));

      expect(queue.stop).not.toHaveBeenCalled();
      expect(
        row("Airhorn").getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();
    });

    it("says when an upload or a removal failed, until the next success", async () => {
      renderWithProviders(<Library />);

      await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        ...failure(),
        data: [airhorn],
      });
      expect(screen.getByText(soundsFailed)).toBeInTheDocument();
      expect(screen.getByText("Airhorn")).toBeInTheDocument();

      await sounds(airhorn, bell);
      expect(screen.queryByText(soundsFailed)).not.toBeInTheDocument();
    });
  });

  describe("images and videos", () => {
    it("shows a thumbnail of each file, newest first", async () => {
      const { container } = await openMedia();

      expect(
        screen.getAllByTitle(/^(Party|Clip)$/).map((tile) => tile.title),
      ).toEqual(["Clip", "Party"]);
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "tokio-media:///party.png",
      );
      expect(container.querySelector("video")?.getAttribute("src")).toMatch(
        /^tokio-media:\/\/\/clip\.webm\?player=.+#t=0\.1$/,
      );
    });

    it("says when the library is empty", async () => {
      const { user } = renderWithProviders(<Library />);
      await media();

      await user.click(tab(/^Images/));

      expect(screen.getByText(mediaEmpty)).toBeInTheDocument();
    });

    it("shows each video's length", async () => {
      const { container } = await openMedia();

      const video = container.querySelector("video")!;
      Object.defineProperty(video, "duration", { value: 75 });
      fireEvent.loadedMetadata(video);

      expect(screen.getByRole("button", { name: "Clip 1:15" })).toBeVisible();
    });

    it("searches the files by name", async () => {
      const { user } = await openMedia();
      await search(user);
      const field = screen.getByPlaceholderText("Search images and videos...");

      await user.type(field, "par");
      expect(screen.getByTitle("Party")).toBeInTheDocument();
      expect(screen.queryByTitle("Clip")).not.toBeInTheDocument();

      await user.type(field, "x");
      expect(screen.getByText("No images or videos match.")).toBeVisible();
    });

    it("adds images and videos with the + button", async () => {
      const { user } = await openMedia();

      await user.click(
        screen.getByRole("button", { name: "Add images and videos" }),
      );

      expect(sent(APP_EVENTS.UPLOAD_MEDIA)).toHaveLength(1);
      expect(sent(APP_EVENTS.UPLOAD_SOUNDS)).toEqual([]);
    });

    it("shows a file full size", async () => {
      const { user } = await openMedia();

      await user.click(screen.getByTitle("Clip"));

      const shown = screen.getByRole("dialog", { name: "Clip" });
      // Its own URL, apart from its thumbnail's
      const full = shown.querySelector("video")?.getAttribute("src");
      expect(full).toMatch(/^tokio-media:\/\/\/clip\.webm\?player=/);
      const thumbnail = [...document.querySelectorAll("video")].find(
        (video) => !video.closest("[role=dialog]"),
      );
      expect(full).not.toBe(thumbnail?.getAttribute("src"));
      await user.click(within(shown).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await user.click(screen.getByTitle("Party"));
      expect(
        within(screen.getByRole("dialog", { name: "Party" })).getByRole("img", {
          name: "Party",
        }),
      ).toHaveAttribute("src", "tokio-media:///party.png");
    });

    it("deletes a file once you confirm", async () => {
      const { user } = await openMedia();

      await user.click(row("Party").getByRole("button", { name: "Delete" }));
      expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([]);
      await user.click(confirmDelete("Delete media?"));

      expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([{ file: "party.png" }]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("says when an upload or a deletion failed, until the next success", async () => {
      const { user } = renderWithProviders(<Library />);
      await user.click(tab(/^Images/));

      await send(APP_EVENTS_RESPONSE.GET_MEDIA, {
        ...failure(),
        data: [party],
      });
      expect(screen.getByText(mediaFailed)).toBeInTheDocument();
      expect(screen.getByTitle("Party")).toBeInTheDocument();

      await media(party, clip);
      expect(screen.queryByText(mediaFailed)).not.toBeInTheDocument();
    });
  });
});
