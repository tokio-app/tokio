import { TestOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getOverlaySocketURL } from "@/common/util";
import { settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import copy from "copy-to-clipboard";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tools } from ".";

vi.mock("copy-to-clipboard", () => ({ default: vi.fn() }));

const CLOCK: TestOverlay = { id: "4f9c2a", name: "Clock" };
const GOAL: TestOverlay = { id: "8b1d7e", name: "Goal" };

const testOverlays = (...data: TestOverlay[]) =>
  send(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, { success: true, data });

const nameInput = () => screen.getByPlaceholderText("Overlay name");
const create = () => screen.getByRole("button", { name: "Create ID" });

// A test overlay's item: its name, buttons, ID and status
function item(name: string) {
  let el: HTMLElement = screen.getByRole("heading", { name });
  while (!el.querySelector("input")) el = el.parentElement!;
  return within(el);
}

describe("Tools", () => {
  beforeEach(() => {
    vi.mocked(copy).mockClear();
  });

  it("asks main for the test overlays and the settings", () => {
    renderWithProviders(<Tools />);

    expect(sentEvents()).toEqual([
      APP_EVENTS.GET_TEST_OVERLAYS,
      APP_EVENTS.GET_SETTINGS,
    ]);
  });

  it("lists the test overlays with their IDs", async () => {
    renderWithProviders(<Tools />);

    await testOverlays(CLOCK, GOAL);

    expect(item("Clock").getByRole("textbox")).toHaveValue(CLOCK.id);
    expect(item("Goal").getByRole("textbox")).toHaveValue(GOAL.id);
    expect(screen.queryByText("No test overlays yet.")).not.toBeInTheDocument();
  });

  it("says when there are no test overlays", async () => {
    renderWithProviders(<Tools />);
    await testOverlays(CLOCK);

    await testOverlays();

    expect(screen.getByText("No test overlays yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Clock" })).toBeNull();
  });

  it("creates a test overlay with the button and clears the name", async () => {
    const { user } = renderWithProviders(<Tools />);

    await user.type(nameInput(), "My overlay");
    await user.click(create());

    expect(sent(APP_EVENTS.ADD_TEST_OVERLAY)).toEqual([{ name: "My overlay" }]);
    expect(nameInput()).toHaveValue("");
  });

  it("creates a test overlay with Enter", async () => {
    const { user } = renderWithProviders(<Tools />);

    await user.type(nameInput(), "Goal{Enter}");

    expect(sent(APP_EVENTS.ADD_TEST_OVERLAY)).toEqual([{ name: "Goal" }]);
    expect(nameInput()).toHaveValue("");
  });

  it("doesn't create a test overlay without a name", async () => {
    const { user } = renderWithProviders(<Tools />);
    expect(create()).toBeDisabled();

    await user.type(nameInput(), "   ");
    expect(create()).toBeDisabled();

    await user.type(nameInput(), "{Enter}");
    expect(sent(APP_EVENTS.ADD_TEST_OVERLAY)).toEqual([]);
    expect(nameInput()).toHaveValue("   ");
  });

  it("deletes a test overlay", async () => {
    const { user } = renderWithProviders(<Tools />);
    await testOverlays(CLOCK, GOAL);

    await user.click(item("Goal").getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.REMOVE_TEST_OVERLAY)).toEqual([{ id: GOAL.id }]);
  });

  it("sends test events to a test overlay", async () => {
    const { user } = renderWithProviders(<Tools />);
    await testOverlays(CLOCK, GOAL);

    await user.click(item("Clock").getByRole("button", { name: "Test" }));

    expect(sent(APP_EVENTS.SEND_TEST_EVENTS)).toEqual([{ id: CLOCK.id }]);
  });

  it("shows under each test overlay whether its events reached it", async () => {
    renderWithProviders(<Tools />);
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
    renderWithProviders(<Tools />);
    const notice = /The overlay server is off\. Enable it in Settings/;
    expect(screen.queryByText(notice)).not.toBeInTheDocument();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = false;
      }),
    );
    expect(screen.getByText(notice)).toBeInTheDocument();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = true;
      }),
    );
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
  });

  it("copies a test overlay's ID and WebSocket URL", async () => {
    const { user } = renderWithProviders(<Tools />);
    await testOverlays(CLOCK, GOAL);

    await user.click(item("Goal").getByRole("button", { name: "Copy ID" }));
    expect(copy).toHaveBeenLastCalledWith(GOAL.id);

    await user.click(
      item("Goal").getByRole("button", { name: "Copy WebSocket URL" }),
    );
    expect(copy).toHaveBeenLastCalledWith(getOverlaySocketURL(GOAL.id));
    expect(copy).toHaveBeenCalledTimes(2);
  });
});
