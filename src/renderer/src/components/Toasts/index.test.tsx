import { AppNotification, FeedbackLevel } from "@/common/types";
import { notification } from "@test/fixtures";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LevelIcon, Toasts } from ".";

function setup(toasts: AppNotification[]) {
  const onExpire = vi.fn<(id: string) => void>();
  const onClose = vi.fn<(id: string) => void>();
  render(<Toasts toasts={toasts} onExpire={onExpire} onClose={onClose} />);
  const user = userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
  });
  return { onExpire, onClose, user };
}

const region = () =>
  within(screen.getByRole("region", { name: "Notifications" }));
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Toasts", () => {
  it("announces errors as alerts and the rest as status", () => {
    setup([
      notification("Profile saved.", { level: "success" }),
      notification("No audio.", { level: "error" }),
      notification("Port in use.", { level: "warning" }),
      notification("Update ready.", { level: "info" }),
    ]);

    expect(region().getByRole("alert")).toHaveTextContent("No audio.");
    expect(
      region()
        .getAllByRole("status")
        .map((t) => t.textContent),
    ).toEqual(["Profile saved.", "Port in use.", "Update ready."]);
  });

  it.each<[FeedbackLevel, number]>([
    ["success", 4000],
    ["info", 4000],
    ["warning", 7000],
    ["error", 10000],
  ])("expires a %s toast after %ims", async (level, duration) => {
    const toast = notification("Notice", { level });
    const { onExpire } = setup([toast]);

    await wait(duration - 1);
    expect(onExpire).not.toHaveBeenCalled();

    await wait(1);
    expect(onExpire).toHaveBeenCalledExactlyOnceWith(toast.id);
  });

  it("pauses while hovered and resumes with the time that was left", async () => {
    const toast = notification("Port in use.", { level: "warning" });
    const { onExpire, user } = setup([toast]);

    await wait(3000);
    await user.hover(region().getByRole("status"));
    await wait(20000);
    expect(onExpire).not.toHaveBeenCalled();

    await user.unhover(region().getByRole("status"));
    await wait(3999);
    expect(onExpire).not.toHaveBeenCalled();

    await wait(1);
    expect(onExpire).toHaveBeenCalledExactlyOnceWith(toast.id);
  });

  it("keeps the time left across several hovers", async () => {
    const toast = notification("Profile saved.", { level: "success" });
    const { onExpire, user } = setup([toast]);
    const status = region().getByRole("status");

    for (const elapsed of [1000, 1500]) {
      await wait(elapsed);
      await user.hover(status);
      await wait(5000);
      await user.unhover(status);
    }
    await wait(1499);
    expect(onExpire).not.toHaveBeenCalled();

    await wait(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("closes a toast with its Close button", async () => {
    const toast = notification("No audio.", { level: "error" });
    const { onClose, onExpire, user } = setup([toast]);

    await user.click(region().getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledExactlyOnceWith(toast.id);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("stacks the toasts oldest first", () => {
    setup([
      notification("First"),
      notification("Second"),
      notification("Third"),
    ]);

    expect(
      region()
        .getAllByRole("status")
        .map((t) => t.textContent),
    ).toEqual(["First", "Second", "Third"]);
  });

  it("expires each toast on its own timer", async () => {
    const success = notification("Profile saved.", { level: "success" });
    const error = notification("No audio.", { level: "error" });
    const { onExpire } = setup([success, error]);

    await wait(4000);
    expect(onExpire.mock.calls).toEqual([[success.id]]);

    await wait(6000);
    expect(onExpire.mock.calls).toEqual([[success.id], [error.id]]);
  });
});

describe("LevelIcon", () => {
  it("draws a different icon for each level", () => {
    const levels: FeedbackLevel[] = ["success", "info", "warning", "error"];
    const icons = levels.map((level) => {
      const { container, unmount } = render(<LevelIcon level={level} />);
      const svg = container.innerHTML;
      unmount();
      return svg;
    });

    expect(new Set(icons).size).toBe(4);
  });

  it("draws the icon at the given size", () => {
    const { container } = render(<LevelIcon level="info" size={16} />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
  });
});
