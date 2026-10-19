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

  it("shows a value set from outside", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(field()).toHaveValue(30);
  });
});
