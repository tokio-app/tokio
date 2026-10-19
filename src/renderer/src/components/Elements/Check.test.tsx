import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Check } from "./Check";

describe("Check", () => {
  it("labels its checkbox and reports changes", async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    render(
      <Check
        label="Followers Only"
        checked={false}
        onChange={(e) => changes.push(e.target.checked)}
      />,
    );

    await user.click(screen.getByText("Followers Only"));

    expect(
      screen.getByRole("checkbox", { name: "Followers Only" }),
    ).not.toBeChecked();
    expect(changes).toEqual([true]);
  });

  it("is a bare checkbox without a label", () => {
    render(<Check aria-label="Enabled" defaultChecked />);

    const box = screen.getByRole("checkbox", { name: "Enabled" });
    expect(box).toBeChecked();
    expect(box.closest("label")).toBeNull();
  });
});
