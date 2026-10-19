import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioGroup } from "./RadioGroup";

const OPTIONS = [
  { value: "any", label: "Read All Comments" },
  {
    value: "dot",
    label: "Dot Prefix",
    description: "Only messages starting with a period will be read.",
  },
] as const;

describe("RadioGroup", () => {
  it("checks the option with the value, and shows descriptions", () => {
    render(
      <RadioGroup
        name="trigger"
        value="dot"
        options={[...OPTIONS]}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("radio", { name: "Read All Comments" }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Dot Prefix/ })).toBeChecked();
    expect(
      screen.getByText("Only messages starting with a period will be read."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("reports the option picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="trigger"
        value="dot"
        options={[...OPTIONS]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText("Read All Comments"));
    await user.click(screen.getByText("Dot Prefix"));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("any");
  });
});
