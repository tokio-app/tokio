import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { newStudioLayer } from "@/common/util";
import { failure, settingsReply, studioOverlay } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const MAIN = studioOverlay("Main scene", {
  id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
  layers: [
    newStudioLayer("text", "portrait"),
    newStudioLayer("gift", "portrait"),
  ],
});
const CHAT = studioOverlay("", {
  id: "6fa459ea-ee8a-4ca4-894e-db77e160355e",
  size: "landscape",
  layers: [newStudioLayer("shape", "landscape")],
});

const studio = (...data: ReturnType<typeof studioOverlay>[]) =>
  send(APP_EVENTS_RESPONSE.STUDIO, { success: true, data });

const page = () => within(screen.getByRole("main"));
const list = () => within(page().getByRole("list", { name: "Your overlays" }));
const row = (name: string) =>
  within(list().getByRole("link", { name }).closest("li")!);
const addButton = () => page().getByRole("button", { name: "New overlay" });

describe("Studio", () => {
  it("asks main for the overlays", async () => {
    await renderApp("/tools/studio");

    expect(sent(APP_EVENTS.GET_STUDIO)).toHaveLength(1);
    expect(page().getByRole("status", { name: "Loading" })).toBeVisible();
    expect(addButton()).toBeDisabled();
  });

  it("says when there are none", async () => {
    await renderApp("/tools/studio");

    await studio();

    expect(page().getByText(/^No overlays yet\./)).toBeVisible();
  });

  it("lists each overlay's name, size and layers, an empty name as untitled", async () => {
    await renderApp("/tools/studio");

    await studio(MAIN, CHAT);

    expect(row("Main scene").getByText("1080 × 1920")).toBeVisible();
    expect(row("Main scene").getByText("2 layers")).toBeVisible();
    expect(row("Untitled overlay").getByText("1920 × 1080")).toBeVisible();
    expect(row("Untitled overlay").getByText("1 layer")).toBeVisible();
  });

  it("opens an overlay's editor from its name", async () => {
    const { user, router } = await renderApp("/tools/studio");
    await studio(MAIN);

    await user.click(list().getByRole("link", { name: "Main scene" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/tools/studio/${MAIN.id}`),
    );
  });

  it("copies an overlay's URL", async () => {
    const { user } = await renderApp("/tools/studio");
    await studio(MAIN);

    await user.click(row("Main scene").getByTitle("Copy overlay URL"));

    expect(await navigator.clipboard.readText()).toBe(
      `http://tokio-app.local:37891/studio/${MAIN.id}/`,
    );
  });

  it("names a new overlay with the first free number, and opens it once main holds it", async () => {
    const { user, router } = await renderApp("/tools/studio");
    await studio(studioOverlay("Overlay 1"), MAIN);

    await user.click(addButton());

    const [{ id, name }] = sent(APP_EVENTS.ADD_STUDIO_OVERLAY);
    expect(name).toBe("Overlay 2");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(router.state.location.pathname).toBe("/tools/studio");

    await studio(MAIN, studioOverlay(name, { id }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/tools/studio/${id}`),
    );
  });

  it("opens nothing when the add fails", async () => {
    const { user, router } = await renderApp("/tools/studio");
    await studio(MAIN);

    await user.click(addButton());
    await send(APP_EVENTS_RESPONSE.STUDIO, { ...failure(), data: [MAIN] });

    expect(router.state.location.pathname).toBe("/tools/studio");
    expect(row("Main scene").getByText("2 layers")).toBeVisible();
  });

  it("asks before deleting an overlay", async () => {
    const { user } = await renderApp("/tools/studio");
    await studio(MAIN);

    await user.click(
      row("Main scene").getByRole("button", { name: "Delete overlay" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete overlay?" });
    expect(dialog).toHaveTextContent(
      "Main scene and its layers will be deleted. Streaming apps using its URL will stop showing it.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.REMOVE_STUDIO_OVERLAY)).toEqual([{ id: MAIN.id }]);
  });

  it("says when the overlay server is off", async () => {
    await renderApp("/tools/studio");

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((store) => {
        store.settings.server.enabled = false;
      }),
    );

    expect(page().getByText(/^The overlay server is off\./)).toBeVisible();
  });

  it("goes back to Tools", async () => {
    const { user, router } = await renderApp("/tools/studio");

    await user.click(page().getByTitle("Back to Tools"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tools"));
  });
});
