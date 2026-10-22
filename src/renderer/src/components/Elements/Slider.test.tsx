import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "./Slider";

describe("Slider", () => {
  it("is a range with its bounds that reports numbers", () => {
    const onChange = vi.fn();
    render(
      <Slider min={0.5} max={2} step={0.1} value={1} onChange={onChange} />,
    );

    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "0.5");
    expect(slider).toHaveAttribute("max", "2");
    expect(slider).toHaveAttribute("step", "0.1");
    expect(slider).toHaveValue("1");

    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  it("steps by 1 unless told otherwise", () => {
    render(<Slider min={0} max={100} value={40} onChange={vi.fn()} />);

    expect(screen.getByRole("slider")).toHaveAttribute("step", "1");
  });
});
