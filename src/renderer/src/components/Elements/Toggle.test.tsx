import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("is a labeled switch that reports changes", async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    render(
      <Toggle
        label="Play alerts at the same time"
        checked
        onChange={(e) => changes.push(e.target.checked)}
      />,
    );

    const toggle = screen.getByRole("checkbox", {
      name: "Play alerts at the same time",
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(changes).toEqual([false]);
  });

  it("can't be changed while disabled", async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    render(
      <Toggle
        label="Enabled"
        disabled
        onChange={(e) => changes.push(e.target.checked)}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Enabled" }));

    expect(changes).toEqual([]);
  });
});
