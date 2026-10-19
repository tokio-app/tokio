import { AlertSound } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { alertSound, failure } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoundsSection } from "./SoundsSection";

const airhorn = alertSound("Airhorn");
const bell = alertSound("Bell");
const data = new Uint8Array([1, 2, 3]);
const failed = "Some sounds couldn't be uploaded or removed.";

const sounds = (...list: AlertSound[]) =>
  send(APP_EVENTS_RESPONSE.GET_SOUNDS, { success: true, data: list });

// A sound's row: its name sits next to its buttons
const row = (name: string) =>
  within(screen.getByTitle(name, { exact: true }).parentElement!);

async function setup() {
  const app = renderWithProviders(<SoundsSection />);
  await sounds(airhorn, bell);
  return { ...app, queue: app.audio.queue("alert-test") };
}

describe("SoundsSection", () => {
  it("lists the sounds in the library", async () => {
    renderWithProviders(<SoundsSection />);
    expect(sent(APP_EVENTS.GET_SOUNDS)).toHaveLength(1);
    expect(screen.getByText("No sounds yet.")).toBeInTheDocument();

    await sounds(airhorn, bell);

    expect(screen.getByText("Airhorn")).toBeInTheDocument();
    expect(screen.getByText("Bell")).toBeInTheDocument();
    expect(screen.queryByText("No sounds yet.")).not.toBeInTheDocument();
  });

  it("uploads sounds", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(sent(APP_EVENTS.UPLOAD_SOUNDS)).toHaveLength(1);
  });

  it("removes a sound", async () => {
    const { user, queue } = await setup();

    await user.click(row("Bell").getByRole("button", { name: "Remove" }));

    expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([{ file: "bell.mp3" }]);
    // Nothing was playing
    expect(queue.stop).not.toHaveBeenCalled();
  });

  it("tests a sound through main", async () => {
    const { user, queue } = await setup();

    await user.click(row("Airhorn").getByRole("button", { name: "Play" }));
    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([
      { id: "airhorn.mp3", file: "airhorn.mp3", volume: 100 },
    ]);
    expect(
      row("Airhorn").getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.TEST_ALERT, {
      success: true,
      id: "airhorn.mp3",
      data,
      volume: 100,
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      data,
      true,
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
      data,
      volume: 100,
    });
    queue.stop.mockClear();

    await user.click(row("Airhorn").getByRole("button", { name: "Remove" }));

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

    await user.click(row("Bell").getByRole("button", { name: "Remove" }));

    expect(queue.stop).not.toHaveBeenCalled();
    expect(
      row("Airhorn").getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("says when an upload or a removal failed, until the next success", async () => {
    renderWithProviders(<SoundsSection />);

    await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      ...failure(),
      data: [airhorn],
    });
    expect(screen.getByText(failed)).toBeInTheDocument();
    expect(screen.getByText("Airhorn")).toBeInTheDocument();

    await sounds(airhorn, bell);
    expect(screen.queryByText(failed)).not.toBeInTheDocument();
  });
});
