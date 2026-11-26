import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { usePopover } from "./usePopover";

function Popover() {
  const { open, toggle, position, anchorRef, popoverRef } = usePopover(8);

  return (
    <div>
      <div ref={anchorRef} data-testid="anchor">
        <button onClick={toggle}>Open</button>
      </div>
      {open && (
        <div ref={popoverRef} role="menu" style={position}>
          Menu
          <div data-testid="menu-list" />
        </div>
      )}
      <p>Elsewhere</p>
      <div data-testid="page" />
    </div>
  );
}

describe("usePopover", () => {
  it("opens under its anchor, after the gap", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    vi.spyOn(
      screen.getByTestId("anchor"),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(12, 20, 200, 20));

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("menu")).toHaveStyle({
      top: "48px",
      left: "12px",
      width: "200px",
    });
  });

  // jsdom's window is 768px tall, and test/renderer/dom.ts makes the menu 600px
  it("opens above its anchor when it doesn't fit below", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    vi.spyOn(
      screen.getByTestId("anchor"),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(12, 700, 200, 20));

    await user.click(screen.getByRole("button", { name: "Open" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveStyle({ bottom: "76px", left: "12px", width: "200px" });
    expect(menu.style.top).toBe("");
  });

  // jsdom's window is 1024px wide, and the menu 600px
  it("moves left when it doesn't fit on the right, the gap from the edge", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    vi.spyOn(
      screen.getByTestId("anchor"),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(900, 20, 32, 32));

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("menu")).toHaveStyle({
      top: "60px",
      left: "416px",
      width: "32px",
    });
  });

  it("closes when toggled again", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    const button = screen.getByRole("button", { name: "Open" });

    await user.click(button);
    await user.click(button);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a press outside, not inside", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    await user.click(screen.getByText("Menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when a scroll moves its anchor, since it doesn't follow it", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    const rect = vi
      .spyOn(screen.getByTestId("anchor"), "getBoundingClientRect")
      .mockReturnValue(new DOMRect(12, 20, 200, 20));
    await user.click(screen.getByRole("button", { name: "Open" }));

    fireEvent.scroll(screen.getByTestId("menu-list"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    rect.mockReturnValue(new DOMRect(12, -80, 200, 20));
    fireEvent.scroll(screen.getByTestId("page"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // A late event from the scroll that brought the anchor into view, or the
  // browser's scroll anchoring, closed a Select as it opened
  it("stays open when a scroll leaves its anchor in place", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    vi.spyOn(
      screen.getByTestId("anchor"),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(12, 20, 200, 20));
    await user.click(screen.getByRole("button", { name: "Open" }));

    fireEvent.scroll(screen.getByTestId("page"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
