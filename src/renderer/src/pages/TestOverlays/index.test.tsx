import { TestOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getOverlaySocketURL } from "@/common/util";
import { settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { section } from "@test/queries";
import { renderApp, renderWithProviders } from "@test/render";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestOverlays } from ".";

const CLOCK: TestOverlay = { id: "4f9c2a", name: "Clock" };
const GOAL: TestOverlay = { id: "8b1d7e", name: "Goal" };

const testOverlays = (...data: TestOverlay[]) =>
  send(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, { success: true, data });

const nameInput = () => screen.getByPlaceholderText("Overlay name");
const create = () => screen.getByRole("button", { name: "Create ID" });

// A test overlay's item: its name, buttons, ID and status
function item(name: string) {
  let el: HTMLElement = screen.getByRole("heading", { name });
  while (!el.querySelector('[title="Copy ID"]')) el = el.parentElement!;
  return within(el);
}

describe("TestOverlays", () => {
  it("asks main for the test overlays and the settings", () => {
    renderWithProviders(<TestOverlays />);

    expect(sentEvents()).toEqual([
      APP_EVENTS.GET_TEST_OVERLAYS,
      APP_EVENTS.GET_SETTINGS,
    ]);
  });

  it("lists the test overlays with their IDs", async () => {
    renderWithProviders(<TestOverlays />);

    await testOverlays(CLOCK, GOAL);

    expect(item("Clock").getByTitle("Copy ID")).toHaveTextContent(CLOCK.id);
    expect(item("Goal").getByTitle("Copy ID")).toHaveTextContent(GOAL.id);
    expect(screen.queryByText("No test overlays yet.")).not.toBeInTheDocument();
  });

  it("says when there are no test overlays", async () => {
    renderWithProviders(<TestOverlays />);
    await testOverlays(CLOCK);

    await testOverlays();

    expect(screen.getByText("No test overlays yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Clock" })).toBeNull();
  });

  it("creates a test overlay with the button and clears the name", async () => {
    const { user } = renderWithProviders(<TestOverlays />);

    await user.type(nameInput(), "My overlay");
    await user.click(create());

    expect(sent(APP_EVENTS.ADD_TEST_OVERLAY)).toEqual([{ name: "My overlay" }]);
    expect(nameInput()).toHaveValue("");
  });

  it("creates a test overlay with Enter", async () => {
    const { user } = renderWithProviders(<TestOverlays />);

    await user.type(nameInput(), "Goal{Enter}");

    expect(sent(APP_EVENTS.ADD_TEST_OVERLAY)).toEqual([{ name: "Goal" }]);
    expect(nameInput()).toHaveValue("");
  });

  it("doesn't create a test overlay without a name", async () => {
    const { user } = renderWithProviders(<TestOverlays />);
    expect(create()).toBeDisabled();

    await user.type(nameInput(), "   ");
    expect(create()).toBeDisabled();

    await user.type(nameInput(), "{Enter}");
    expect(sent(APP_EVENTS.ADD_TEST_OVERLAY)).toEqual([]);
    expect(nameInput()).toHaveValue("   ");
  });

  it("deletes a test overlay", async () => {
    const { user } = renderWithProviders(<TestOverlays />);
    await testOverlays(CLOCK, GOAL);

    await user.click(item("Goal").getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.REMOVE_TEST_OVERLAY)).toEqual([{ id: GOAL.id }]);
  });

  it("sends test events to a test overlay", async () => {
    const { user } = renderWithProviders(<TestOverlays />);
    await testOverlays(CLOCK, GOAL);

    await user.click(item("Clock").getByRole("button", { name: "Test" }));

    expect(sent(APP_EVENTS.SEND_TEST_EVENTS)).toEqual([{ id: CLOCK.id }]);
  });

  it("shows under each test overlay whether its events reached it", async () => {
    renderWithProviders(<TestOverlays />);
    await testOverlays(CLOCK, GOAL);
    expect(screen.queryByText("Test events sent.")).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, {
      success: true,
      id: CLOCK.id,
    });
    await send(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, {
      success: false,
      id: GOAL.id,
    });

    expect(item("Clock").getByText("Test events sent.")).toBeInTheDocument();
    expect(
      item("Goal").getByText("No overlay connected with this ID."),
    ).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, {
      success: true,
      id: GOAL.id,
    });

    expect(item("Goal").getByText("Test events sent.")).toBeInTheDocument();
    expect(
      screen.queryByText("No overlay connected with this ID."),
    ).not.toBeInTheDocument();
  });

  it("warns while the overlay server is off", async () => {
    renderWithProviders(<TestOverlays />);
    const notice =
      "The overlay server is off. Enable it in Settings to send test events.";
    expect(screen.queryByText(notice)).not.toBeInTheDocument();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = false;
      }),
    );
    expect(screen.getByText(notice)).toBeInTheDocument();
    // Above the section
    expect(section("Test overlays").queryByText(notice)).toBeNull();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = true;
      }),
    );
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
  });

  it("copies a test overlay's ID and WebSocket URL", async () => {
    const { user } = renderWithProviders(<TestOverlays />);
    await testOverlays(CLOCK, GOAL);

    await user.click(item("Goal").getByTitle("Copy ID"));
    expect(await navigator.clipboard.readText()).toBe(GOAL.id);

    const url = item("Goal").getByTitle("Copy WebSocket URL");
    expect(url).toHaveTextContent(getOverlaySocketURL(GOAL.id));
    await user.click(url);
    expect(await navigator.clipboard.readText()).toBe(
      getOverlaySocketURL(GOAL.id),
    );
  });

  it("goes back to Tools", async () => {
    const { user, router } = await renderApp("/tools/test-overlays");

    await user.click(screen.getByRole("button", { name: "Back to Tools" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tools"));
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  });
});
