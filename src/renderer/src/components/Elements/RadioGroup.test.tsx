import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioGroup } from "./RadioGroup";

const OPTIONS = [
  { value: "any", label: "Read all messages" },
  {
    value: "dot",
    label: "Dot prefix",
    description: "Reads only messages that start with a period.",
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
      screen.getByRole("radio", { name: "Read all messages" }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Dot prefix/ })).toBeChecked();
    expect(
      screen.getByText("Reads only messages that start with a period."),
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

    await user.click(screen.getByText("Read all messages"));
    await user.click(screen.getByText("Dot prefix"));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("any");
  });
});
