import { APP_EVENTS } from "@/common/types";
import { mediaFile } from "@test/fixtures";
import { sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeletePictureModal } from ".";

describe("DeletePictureModal", () => {
  it("says what deleting a Minecraft picture does, and asks main to", async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const { user } = renderWithProviders(
      <DeletePictureModal
        item={mediaFile("TNT")}
        onClose={onClose}
        onDelete={onDelete}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Delete picture?" }),
    ).toHaveTextContent(
      '"TNT" will be deleted from your computer and from every game action that shows it, in all your profiles.',
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(mediaFile("TNT"));
    expect(sent(APP_EVENTS.REMOVE_MINECRAFT_PICTURE)).toEqual([
      { file: "tnt.png" },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("deletes nothing when canceled", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <DeletePictureModal item={mediaFile("TNT")} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(sent(APP_EVENTS.REMOVE_MINECRAFT_PICTURE)).toEqual([]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
