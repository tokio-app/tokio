import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberInput } from "./NumberInput";

// Holds the value, like a settings page does
function Field({
  initial = 10,
  onChange,
  ...props
}: { initial?: number } & Partial<ComponentProps<typeof NumberInput>>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberInput
        aria-label="Cooldown"
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button onClick={() => setValue(30)}>Load</button>
    </>
  );
}

const field = () => screen.getByRole("spinbutton", { name: "Cooldown" });

describe("NumberInput", () => {
  it("can be emptied and typed again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    await user.clear(field());
    expect(field()).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();

    await user.type(field(), "5");
    expect(field()).toHaveValue(5);
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("shows the last value again when left empty", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.clear(field());
    await user.tab();

    expect(field()).toHaveValue(10);
  });

  it("only reports numbers within its limits", () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} min={1} max={50} integer />);

    // Whole values, typing "51" would report the 5 on the way
    for (const value of ["0", "51", "2.5", "-3"]) {
      fireEvent.change(field(), { target: { value } });
    }
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(field(), { target: { value: "25" } });
    expect(onChange).toHaveBeenLastCalledWith(25);
  });

  it("takes fractions unless it's for whole numbers", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    await user.clear(field());
    await user.type(field(), "1.5");

    expect(onChange).toHaveBeenLastCalledWith(1.5);
  });

  it("drags its value while pressed, a px a step, ten with Shift", () => {
    Element.prototype.setPointerCapture = vi.fn();
    const onChange = vi.fn();
    render(<Field onChange={onChange} scrub integer min={0} max={40} />);

    fireEvent.pointerDown(field(), { button: 0, clientX: 100 });
    // Not in the field yet, its cursor a double arrow
    expect(fireEvent.mouseDown(field())).toBe(false);
    expect(field().className).toMatch(/scrubbing/);
    // A click until it moves 3 px
    fireEvent.pointerMove(field(), { clientX: 102 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(field(), { clientX: 125 });
    expect(field()).toHaveValue(35);
    // Held at its max, and back down from there at once
    fireEvent.pointerMove(field(), { clientX: 126, shiftKey: true });
    expect(field()).toHaveValue(40);
    fireEvent.pointerMove(field(), { clientX: 120 });
    expect(field()).toHaveValue(34);
    fireEvent.pointerUp(field());

    expect(onChange.mock.calls).toEqual([[35], [40], [34]]);
    expect(field().className).not.toMatch(/scrubbing/);
    expect(field()).not.toHaveFocus();
  });

  it("types in a dragged field after a click, and drags nothing while typed in", () => {
    Element.prototype.setPointerCapture = vi.fn();
    const onChange = vi.fn();
    render(<Field onChange={onChange} scrub />);

    fireEvent.pointerDown(field(), { button: 0, clientX: 100 });
    fireEvent.pointerUp(field());
    expect(field()).toHaveFocus();

    // Pressed again, it selects text as any field does
    fireEvent.pointerDown(field(), { button: 0, clientX: 100 });
    expect(fireEvent.mouseDown(field())).toBe(true);
    fireEvent.pointerMove(field(), { clientX: 150 });
    fireEvent.pointerUp(field());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a value set from outside", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(field()).toHaveValue(30);
  });
});
