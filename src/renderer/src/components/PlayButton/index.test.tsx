import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlayButton, testProps } from ".";

describe("PlayButton", () => {
  it("plays when idle, stops while playing and cancels while loading", () => {
    const { rerender } = render(
      <PlayButton playing={false} onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toHaveAccessibleName("Play");

    rerender(<PlayButton playing onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Stop");

    rerender(<PlayButton playing loading onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Cancel");
  });

  it("shows a spinner instead of its icon while loading", () => {
    const { rerender } = render(<PlayButton playing onClick={vi.fn()} />);
    expect(screen.getByRole("button").querySelector("svg")).not.toBeNull();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<PlayButton playing loading onClick={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.querySelector("svg")).toBeNull();
    expect(
      within(button).getByRole("status", { name: "Loading" }),
    ).toBeInTheDocument();
  });

  it("calls onClick in every state", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <PlayButton playing={false} onClick={onClick} />,
    );

    await user.click(screen.getByRole("button", { name: "Play" }));
    rerender(<PlayButton playing loading onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<PlayButton playing onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("doesn't fire while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PlayButton playing={false} disabled onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("testProps", () => {
  it("is idle without a test", () => {
    expect(testProps(null, "alert-1")).toEqual({
      playing: false,
      loading: false,
    });
  });

  it("follows the test with the same id", () => {
    expect(testProps({ id: "alert-1", loading: true }, "alert-1")).toEqual({
      playing: true,
      loading: true,
    });
    expect(testProps({ id: "alert-1", loading: false }, "alert-1")).toEqual({
      playing: true,
      loading: false,
    });
  });

  it("is idle for another id's test", () => {
    expect(testProps({ id: "alert-2", loading: true }, "alert-1")).toEqual({
      playing: false,
      loading: false,
    });
  });
});
