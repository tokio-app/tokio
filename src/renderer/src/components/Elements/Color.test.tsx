import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../Modal";
import { Color } from "./Color";

// Holds the color, as a settings form does
function Form({ onChange }: { onChange: (color: string) => void }) {
  const [color, setColor] = useState("#ff0000");
  return (
    <Color
      value={color}
      onChange={(next) => {
        setColor(next);
        onChange(next);
      }}
    />
  );
}

async function typeColor(text: string) {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Form onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Choose color" }));
  const input = screen.getByPlaceholderText("Type a color");
  await user.clear(input);
  await user.type(input, text);
  return { user, onChange, input };
}

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

  it("sends a short color in full, and the typing goes on", async () => {
    const { user, onChange, input } = await typeColor("fff");

    expect(onChange).toHaveBeenLastCalledWith("#ffffff");
    expect(input).toHaveValue("#fff");

    await user.type(input, "000");

    expect(onChange).toHaveBeenLastCalledWith("#fff000");
    expect(input).toHaveValue("#fff000");
  });

  it("shows a short color in full once the field is left", async () => {
    const { user, onChange, input } = await typeColor("fff8");
    expect(onChange).toHaveBeenLastCalledWith("#ffffff88");

    // Back to the picker's alpha slider
    await user.tab({ shift: true });

    expect(input).toHaveValue("#ffffff88");
  });

  it("shows a short color in full when it opens again", async () => {
    const { user } = await typeColor("0f0");
    const swatch = screen.getByRole("button", { name: "Choose color" });

    await user.click(document.body);
    await user.click(swatch);

    expect(screen.getByPlaceholderText("Type a color")).toHaveValue("#00ff00");
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

  it("takes the keyboard into the picker and back to its swatch, inside the modal", async () => {
    const user = userEvent.setup();
    render(
      <Modal title="Settings" onClose={vi.fn()}>
        <Color value="#ff0000" onChange={vi.fn()} />
      </Modal>,
    );
    const swatch = screen.getByRole("button", { name: "Choose color" });
    swatch.focus();

    await user.keyboard("{Enter}");
    expect(screen.getByPlaceholderText("Type a color")).toHaveFocus();
    await user.tab();

    expect(
      screen.queryByPlaceholderText("Type a color"),
    ).not.toBeInTheDocument();
    expect(swatch).toHaveFocus();

    await user.keyboard("{Enter}");
    const sliders = screen.getAllByRole("slider");
    for (const _ of sliders) await user.tab({ shift: true });
    expect(sliders[0]).toHaveFocus();
    await user.tab({ shift: true });

    expect(
      screen.queryByPlaceholderText("Type a color"),
    ).not.toBeInTheDocument();
    expect(swatch).toHaveFocus();
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
