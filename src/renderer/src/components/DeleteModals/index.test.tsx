import { APP_EVENTS } from "@/common/types";
import { mediaFile } from "@test/fixtures";
import { sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ClearHistoryModal,
  DeleteLiveModal,
  DeletePictureModal,
  DeleteStudioOverlayModal,
} from ".";

describe("DeleteStudioOverlayModal", () => {
  const item = { id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Main" };

  it("says what deleting an overlay does, and asks main to", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <DeleteStudioOverlayModal item={item} onClose={onClose} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Delete overlay?" }),
    ).toHaveTextContent(
      "Main and its layers will be deleted. Streaming apps using its URL will stop showing it.",
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.REMOVE_STUDIO_OVERLAY)).toEqual([{ id: item.id }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("deletes nothing when canceled", async () => {
    const { user } = renderWithProviders(
      <DeleteStudioOverlayModal item={item} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(sent(APP_EVENTS.REMOVE_STUDIO_OVERLAY)).toEqual([]);
  });
});

describe("DeleteLiveModal", () => {
  it("names the LIVE by when it started, and asks main to delete it", async () => {
    const startedAt = new Date(2026, 9, 31, 20, 14).getTime();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <DeleteLiveModal item={{ startedAt }} onClose={onClose} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Delete LIVE?" }),
    ).toHaveTextContent(
      /The LIVE from Saturday, October 31, 2026 at 8:14\sPM will be deleted, and its gifts will no longer count in All time\./,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.DELETE_LIVE)).toEqual([{ startedAt }]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ClearHistoryModal", () => {
  it("asks main to clear the history", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <ClearHistoryModal onClose={onClose} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Clear history?" }),
    ).toHaveTextContent("A LIVE you're connected to keeps counting.");
    await user.click(screen.getByRole("button", { name: "Clear history" }));

    expect(sent(APP_EVENTS.CLEAR_LIVES)).toEqual([undefined]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears nothing when canceled", async () => {
    const { user } = renderWithProviders(
      <ClearHistoryModal onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(sent(APP_EVENTS.CLEAR_LIVES)).toEqual([]);
  });
});

describe("DeletePictureModal", () => {
  it("says what deleting a Minecraft picture does, and asks main to", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <DeletePictureModal item={mediaFile("TNT")} onClose={onClose} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Delete picture?" }),
    ).toHaveTextContent(
      '"TNT" will be deleted from your computer and from every game action that shows it, in all your profiles.',
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

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
