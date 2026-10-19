import { AppNotification, APP_EVENTS_RESPONSE } from "@/common/types";
import { useNotifications } from "@/hooks/useNotifications";
import { notification } from "@test/fixtures";
import { send } from "@test/ipc";
import {
  act,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsProvider } from ".";

// What the bell reads, and every history it was given
const histories: AppNotification[][] = [];

function Bell() {
  const { history, unread, unreadError, markSeen, clear } = useNotifications();
  histories.push(history);

  return (
    <div>
      <p>
        Unread: {unread}
        {unreadError && " (error)"}
      </p>
      <ul aria-label="History">
        {history.map((n) => (
          <li key={n.id}>{n.message}</li>
        ))}
      </ul>
      <button onClick={markSeen}>Seen</button>
      <button onClick={clear}>Clear</button>
    </div>
  );
}

function setup() {
  render(
    <NotificationsProvider>
      <Bell />
    </NotificationsProvider>,
  );
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

const notify = (message: string, patch?: Partial<AppNotification>) =>
  send(APP_EVENTS_RESPONSE.NOTIFY, notification(message, patch));

const toasts = () => screen.getByRole("region", { name: "Notifications" });
const history = () =>
  within(screen.getByRole("list", { name: "History" }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  histories.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationsProvider", () => {
  it("shows a notice as a toast and keeps it in the history", async () => {
    setup();

    await notify("The LIVE has ended.");

    expect(within(toasts()).getByRole("status")).toHaveTextContent(
      "The LIVE has ended.",
    );
    expect(history()).toEqual(["The LIVE has ended."]);
    // Still on screen, so not missed
    expect(screen.getByText("Unread: 0")).toBeInTheDocument();
  });

  it("announces errors as alerts", async () => {
    setup();

    await notify("No audio.", { level: "error" });

    expect(within(toasts()).getByRole("alert")).toHaveTextContent("No audio.");
  });

  it("counts a notice as unread once its toast times out", async () => {
    setup();
    await notify("Port in use.", { level: "warning" });

    await wait(6999);
    expect(within(toasts()).getByRole("status")).toBeInTheDocument();

    await wait(1);
    expect(within(toasts()).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Unread: 1")).toBeInTheDocument();
  });

  it("flags unread errors", async () => {
    setup();
    await notify("No audio.", { level: "error" });

    await wait(10000);

    expect(screen.getByText("Unread: 1 (error)")).toBeInTheDocument();
  });

  it("counts a closed toast as read", async () => {
    const user = setup();
    await notify("Port in use.", { level: "warning" });

    await user.click(within(toasts()).getByRole("button", { name: "Close" }));

    expect(within(toasts()).queryByRole("status")).not.toBeInTheDocument();
    expect(history()).toEqual(["Port in use."]);
    expect(screen.getByText("Unread: 0")).toBeInTheDocument();
  });

  it("never counts a success as unread", async () => {
    setup();
    await notify("Profile saved.", { level: "success" });

    await wait(4000);

    expect(screen.getByText("Unread: 0")).toBeInTheDocument();
  });

  it("keeps four toasts on screen, and the older ones in the history", async () => {
    setup();

    for (const n of [1, 2, 3, 4, 5]) await notify(`Notice ${n}`);

    const shown = within(toasts()).getAllByRole("status");
    expect(shown.map((t) => t.textContent)).toEqual([
      "Notice 2",
      "Notice 3",
      "Notice 4",
      "Notice 5",
    ]);
    expect(history()).toHaveLength(5);
    // Notice 1 left without being read
    expect(screen.getByText("Unread: 1")).toBeInTheDocument();
  });

  it("keeps the last 50 notices, newest first", async () => {
    setup();

    for (let n = 1; n <= 51; n++) await notify(`Notice ${n}`);

    const items = history();
    expect(items).toHaveLength(50);
    expect(items[0]).toBe("Notice 51");
    expect(items.at(-1)).toBe("Notice 2");
  });

  it("marks everything as seen, and clears it all", async () => {
    const user = setup();
    await notify("One");
    await notify("Two");
    await wait(4000);
    expect(screen.getByText("Unread: 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Seen" }));
    expect(screen.getByText("Unread: 0")).toBeInTheDocument();

    await notify("Three");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(history()).toEqual([]);
    expect(within(toasts()).queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the same history when there's nothing to mark", async () => {
    const user = setup();
    await notify("Profile saved.", { level: "success" });
    const before = histories.at(-1);

    // The bell calls it on every update, a new array would loop
    await user.click(screen.getByRole("button", { name: "Seen" }));

    expect(histories.at(-1)).toBe(before);
  });

  it("is required by useNotifications", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useNotifications())).toThrow(
      "useNotifications must be used within a NotificationsProvider",
    );
  });
});
