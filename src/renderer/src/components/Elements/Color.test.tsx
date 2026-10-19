import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../Modal";
import { Color } from "./Color";

describe("Color", () => {
  it("shows the color on its swatch", () => {
    render(<Color value="#ff0000" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Choose color" })).toHaveStyle({
      backgroundColor: "rgb(255, 0, 0)",
    });
  });

  it("opens a picker that takes a typed color", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Color value="#ff0000" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Choose color" }));
    const input = screen.getByPlaceholderText("Type a color");
    expect(input).toHaveValue("#ff0000");

    await user.clear(input);
    await user.type(input, "00ff0080");

    expect(onChange).toHaveBeenLastCalledWith("#00ff0080");
  });

  it("closes on Escape, not the modal it's in", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        <Color value="#ff0000" onChange={vi.fn()} />
      </Modal>,
    );
    const swatch = screen.getByRole("button", { name: "Choose color" });
    await user.click(swatch);
    expect(swatch).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");

    expect(
      screen.queryByPlaceholderText("Type a color"),
    ).not.toBeInTheDocument();
    expect(swatch).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    render(<Color value="#ff0000" onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Choose color" }));

    await user.click(document.body);

    expect(
      screen.queryByPlaceholderText("Type a color"),
    ).not.toBeInTheDocument();
  });
});
