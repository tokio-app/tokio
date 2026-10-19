import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useClickOutside } from "./useClickOutside";

function Areas({
  onOutside,
  enabled,
}: {
  onOutside: () => void;
  enabled?: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  useClickOutside([menu, anchor], onOutside, enabled);

  return (
    <div>
      <div ref={menu}>
        Menu <button>Item</button>
      </div>
      <div ref={anchor}>Anchor</div>
      <p>Outside</p>
    </div>
  );
}

describe("useClickOutside", () => {
  it("calls back on a press outside every element", async () => {
    const user = userEvent.setup();
    const onOutside = vi.fn();
    render(<Areas onOutside={onOutside} />);

    await user.click(screen.getByRole("button", { name: "Item" }));
    await user.click(screen.getByText("Anchor"));
    expect(onOutside).not.toHaveBeenCalled();

    await user.click(screen.getByText("Outside"));
    expect(onOutside).toHaveBeenCalledOnce();
  });

  it("does nothing while disabled", async () => {
    const user = userEvent.setup();
    const onOutside = vi.fn();
    render(<Areas onOutside={onOutside} enabled={false} />);

    await user.click(screen.getByText("Outside"));

    expect(onOutside).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", () => {
    const onOutside = vi.fn();
    const { unmount } = render(<Areas onOutside={onOutside} />);

    unmount();
    fireEvent.mouseDown(document.body);

    expect(onOutside).not.toHaveBeenCalled();
  });
});
