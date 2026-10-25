import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure, mediaFile } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PicturePicker } from "./PicturePicker";

const LIBRARY = [mediaFile("TNT"), mediaFile("Creeper"), mediaFile("Zombie")];

function setup(picture: MediaFile | null = null) {
  const handlers = {
    onRequest: vi.fn(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };
  const view = renderWithProviders(
    <PicturePicker id="a1" picture={picture} {...handlers} />,
  );
  return { ...view, ...handlers };
}

const library = () =>
  send(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
    success: true,
    data: LIBRARY,
  });

// A picture's tile: its thumbnail and name pick it, next to its delete button
const tile = (name: string) =>
  within(screen.getByRole("button", { name }).parentElement!);

describe("PicturePicker", () => {
  it("shows the Minecraft library, searched from the title's row", async () => {
    const { user } = setup();
    expect(sent(APP_EVENTS.GET_MINECRAFT_PICTURES)).toHaveLength(1);
    expect(
      screen.getByText(
        "No pictures yet. Browse for the items and mobs your actions make.",
      ),
    ).toBeInTheDocument();

    await library();
    expect(
      [...screen.getByRole("dialog").querySelectorAll("img")].map((img) =>
        img.getAttribute("src"),
      ),
    ).toEqual([
      "tokio-media:///games/minecraft/tnt.png",
      "tokio-media:///games/minecraft/creeper.png",
      "tokio-media:///games/minecraft/zombie.png",
    ]);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByPlaceholderText("Search your pictures..."),
      "cr",
    );
    expect(screen.queryByRole("button", { name: "TNT" })).toBeNull();
    expect(screen.getByRole("button", { name: "Creeper" })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Search your pictures..."),
      "x",
    );
    expect(screen.getByText("No pictures match.")).toBeInTheDocument();
  });

  it("marks the action's picture, and picks another", async () => {
    const { user, onSelect } = setup(LIBRARY[1]);
    await library();

    expect(screen.getByRole("button", { current: true })).toHaveAccessibleName(
      "Creeper",
    );

    await user.click(screen.getByRole("button", { name: "Zombie" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(LIBRARY[2]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clears the action's picture, and closes with Done", async () => {
    const { user, onSelect, onClose } = setup(LIBRARY[0]);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has nothing to clear without a picture", () => {
    setup();

    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("asks main to browse for pictures for the action", async () => {
    const { user, onRequest } = setup();

    await user.click(screen.getByRole("button", { name: "Browse files..." }));

    expect(onRequest).toHaveBeenCalledOnce();
    expect(sent(APP_EVENTS.IMPORT_MINECRAFT_PICTURE)).toEqual([{ id: "a1" }]);
  });

  it("deletes a picture once you confirm, and keeps it when you cancel", async () => {
    const { user, onSelect } = setup();
    await library();

    await user.click(tile("TNT").getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete picture?" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    expect(sent(APP_EVENTS.REMOVE_MINECRAFT_PICTURE)).toEqual([]);

    await user.click(tile("Creeper").getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete picture?" })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );

    expect(sent(APP_EVENTS.REMOVE_MINECRAFT_PICTURE)).toEqual([
      { file: "creeper.png" },
    ]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("says when main couldn't save or load the pictures", async () => {
    setup();

    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      ...failure(),
      id: "a2",
    });
    expect(screen.queryByText(/Couldn't save/)).toBeNull();

    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      ...failure(),
      id: "a1",
    });
    expect(
      screen.getByText("Couldn't save or load the pictures."),
    ).toBeInTheDocument();

    await library();
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });
});
