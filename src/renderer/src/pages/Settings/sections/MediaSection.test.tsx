import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure, mediaFile } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MediaSection } from "./MediaSection";

const party = mediaFile("Party");
const clip = { name: "Clip", file: "clip.webm" };
const failed = "Some media couldn't be uploaded or removed.";

const media = (...list: MediaFile[]) =>
  send(APP_EVENTS_RESPONSE.GET_MEDIA, { success: true, data: list });

// A file's row: its name sits next to its buttons
const row = (name: string) =>
  within(screen.getByTitle(name, { exact: true }).parentElement!);

async function setup() {
  const app = renderWithProviders(<MediaSection />);
  await media(party, clip);
  return app;
}

describe("MediaSection", () => {
  it("lists the media library with a thumbnail of each file", async () => {
    const { container } = renderWithProviders(<MediaSection />);
    expect(sent(APP_EVENTS.GET_MEDIA)).toHaveLength(1);
    expect(screen.getByText("No media yet.")).toBeInTheDocument();

    await media(party, clip);

    expect(screen.getByText("Party")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "tokio-media:///party.png",
    );
    expect(container.querySelector("video")?.getAttribute("src")).toMatch(
      /^tokio-media:\/\/\/clip\.webm\?player=.+#t=0\.1$/,
    );
  });

  it("shows each video's length", async () => {
    const { container } = await setup();

    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 75 });
    fireEvent.loadedMetadata(video);

    expect(row("Clip").getByText("1:15")).toBeInTheDocument();
  });

  it("uploads images and videos", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(sent(APP_EVENTS.UPLOAD_MEDIA)).toHaveLength(1);
  });

  it("shows a file full size", async () => {
    const { user } = await setup();

    await user.click(row("Clip").getByRole("button", { name: "Full size" }));

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

    await user.click(row("Party").getByRole("button", { name: "Full size" }));
    expect(
      within(screen.getByRole("dialog", { name: "Party" })).getByRole("img", {
        name: "Party",
      }),
    ).toHaveAttribute("src", "tokio-media:///party.png");
  });

  it("deletes a file once you confirm", async () => {
    const { user } = await setup();

    await user.click(row("Party").getByRole("button", { name: "Delete" }));
    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([]);
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete media?" })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );

    expect(sent(APP_EVENTS.REMOVE_MEDIA)).toEqual([{ file: "party.png" }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when an upload or a deletion failed, until the next success", async () => {
    renderWithProviders(<MediaSection />);

    await send(APP_EVENTS_RESPONSE.GET_MEDIA, { ...failure(), data: [party] });
    expect(screen.getByText(failed)).toBeInTheDocument();
    expect(screen.getByText("Party")).toBeInTheDocument();

    await media(party, clip);
    expect(screen.queryByText(failed)).not.toBeInTheDocument();
  });
});
