import { AppNotification } from "@/common/types";
import { notification } from "@test/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationBell } from ".";

type Props = {
  history?: AppNotification[];
  unread?: number;
  onSeen?: () => void;
  onClear?: () => void;
};

function bell({
  history = [],
  unread = 0,
  onSeen = vi.fn(),
  onClear = vi.fn(),
}: Props = {}) {
  return (
    <NotificationBell
      history={history}
      unread={unread}
      unreadError={false}
      onSeen={onSeen}
      onClear={onClear}
    />
  );
}

const toggle = () => screen.getByRole("button", { name: /^Notifications/ });
const list = () => screen.queryByRole("list");

describe("NotificationBell", () => {
  it("shows the unread count on its badge, capped at 9+", () => {
    const { rerender } = render(bell({ unread: 0 }));
    expect(toggle()).toHaveTextContent("");

    rerender(bell({ unread: 3 }));
    expect(toggle()).toHaveTextContent(/^3$/);

    rerender(bell({ unread: 9 }));
    expect(toggle()).toHaveTextContent(/^9$/);

    rerender(bell({ unread: 10 }));
    expect(toggle()).toHaveTextContent(/^9\+$/);
  });

  it("is named Notifications, with the unread count", () => {
    const { rerender } = render(bell({ unread: 0 }));
    expect(toggle()).toHaveAccessibleName("Notifications");

    rerender(bell({ unread: 12 }));
    expect(toggle()).toHaveAccessibleName("Notifications, 12 unread");
  });

  it("closes on Escape and gives the focus back to its button", async () => {
    const user = userEvent.setup();
    render(bell({ history: [notification("One")] }));
    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");

    expect(list()).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveFocus();
  });

  it("says when there are no notices yet", async () => {
    const user = userEvent.setup();
    render(bell());

    await user.click(toggle());

    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
    expect(list()).not.toBeInTheDocument();
  });

  it("lists each notice with its time", async () => {
    const user = userEvent.setup();
    const at = (hours: number, minutes: number) =>
      new Date(2026, 9, 19, hours, minutes).getTime();
    render(
      bell({
        history: [
          notification("Port in use.", {
            level: "warning",
            timestamp: at(14, 5),
          }),
          notification("Profile saved.", {
            level: "success",
            timestamp: at(9, 30),
          }),
        ],
      }),
    );

    await user.click(toggle());

    const items = within(list()!).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Port in use.");
    // 14:05 or 02:05 PM, depending on the locale
    expect(within(items[0]).getByText(/(14|02):05/)).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Profile saved.");
    expect(within(items[1]).getByText(/09:30/)).toBeInTheDocument();
    expect(screen.queryByText("No notifications yet")).not.toBeInTheDocument();
  });

  it("marks the notices as seen when it opens, and new ones while it's open", async () => {
    const user = userEvent.setup();
    const onSeen = vi.fn();
    const first = [notification("One")];
    const { rerender } = render(bell({ history: first, onSeen }));

    // Closed, new notices stay unread
    rerender(bell({ history: [notification("Two"), ...first], onSeen }));
    expect(onSeen).not.toHaveBeenCalled();

    await user.click(toggle());
    expect(onSeen).toHaveBeenCalledOnce();

    const open = [notification("Three"), ...first];
    rerender(bell({ history: open, onSeen }));
    expect(onSeen).toHaveBeenCalledTimes(2);

    rerender(bell({ history: open, onSeen, unread: 0 }));
    expect(onSeen).toHaveBeenCalledTimes(2);

    await user.click(toggle());
    rerender(bell({ history: [notification("Four"), ...open], onSeen }));
    expect(onSeen).toHaveBeenCalledTimes(2);
  });

  it("clears the history with Clear all", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(bell({ history: [notification("One")], onClear }));

    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onClear).toHaveBeenCalledOnce();
  });

  it("has no Clear all without notices", async () => {
    const user = userEvent.setup();
    render(bell());

    await user.click(toggle());

    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });

  it("closes when the toggle is clicked again", async () => {
    const user = userEvent.setup();
    render(bell({ history: [notification("One")] }));

    await user.click(toggle());
    await user.click(toggle());

    expect(list()).not.toBeInTheDocument();
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    render(bell({ history: [notification("One")] }));
    await user.click(toggle());

    await user.click(screen.getByText("One"));
    expect(list()).toBeInTheDocument();

    await user.click(document.body);
    expect(list()).not.toBeInTheDocument();
  });
});
