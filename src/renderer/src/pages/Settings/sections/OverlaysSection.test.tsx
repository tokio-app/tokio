import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { failure, overlayApp } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverlaysSection } from "./OverlaysSection";

const giftJar = overlayApp("gift-jar", { name: "Gift Jar" });
const goal = overlayApp("5f0c7a52", {
  name: "My Goal",
  version: "2.1.0",
  external: true,
});
const chat = overlayApp("9b1e33d0", { name: "Chat Box", external: true });
const empty = "No overlays imported yet.";

const overlays = (...data: OverlayApp[]) =>
  send(APP_EVENTS_RESPONSE.GET_OVERLAYS, { success: true, data });

// An overlay's row: its name sits next to its version and Remove button
const row = (name: string) =>
  within(screen.getByTitle(name, { exact: true }).parentElement!);
const dialog = () => within(screen.getByRole("dialog"));

async function setup() {
  const app = renderWithProviders(<OverlaysSection />);
  await overlays(giftJar, goal, chat);
  return app;
}

describe("OverlaysSection", () => {
  it("lists only the imported overlays", async () => {
    renderWithProviders(<OverlaysSection />);
    expect(sent(APP_EVENTS.GET_OVERLAYS)).toHaveLength(1);
    expect(screen.getByText(empty)).toBeInTheDocument();

    await overlays(giftJar, goal, chat);

    expect(row("My Goal").getByText("2.1.0")).toBeInTheDocument();
    expect(row("Chat Box").getByText("1.0.0")).toBeInTheDocument();
    expect(screen.queryByText("Gift Jar")).not.toBeInTheDocument();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it("says when no overlay was imported, even with official ones", async () => {
    renderWithProviders(<OverlaysSection />);

    await overlays(giftJar);

    expect(screen.getByText(empty)).toBeInTheDocument();
  });

  it("keeps the list a failed reply brings", async () => {
    await setup();

    await send(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      ...failure(),
      data: [goal],
    });

    expect(screen.getByText("My Goal")).toBeInTheDocument();
    expect(screen.queryByText("Chat Box")).not.toBeInTheDocument();
  });

  it("imports an overlay", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(sent(APP_EVENTS.IMPORT_OVERLAY)).toHaveLength(1);
  });

  it("asks before removing an overlay, and Cancel keeps it", async () => {
    const { user } = await setup();

    await user.click(row("My Goal").getByRole("button", { name: "Remove" }));
    expect(dialog().getByText("Remove overlay?")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "My Goal and its settings will be deleted.",
    );

    await user.click(dialog().getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sent(APP_EVENTS.REMOVE_OVERLAY)).toEqual([]);
  });

  it("removes the overlay once confirmed", async () => {
    const { user } = await setup();

    await user.click(row("Chat Box").getByRole("button", { name: "Remove" }));
    await user.click(dialog().getByRole("button", { name: "Remove" }));

    expect(sent(APP_EVENTS.REMOVE_OVERLAY)).toEqual([{ id: "9b1e33d0" }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
