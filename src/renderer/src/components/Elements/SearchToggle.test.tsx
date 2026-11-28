import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchToggle } from "./SearchToggle";

describe("SearchToggle", () => {
  it("starts closed without a search", () => {
    renderWithProviders(
      <SearchToggle value="" onChange={vi.fn()} placeholder="Find" />,
    );

    expect(screen.getByRole("button", { name: "Search" })).toBeVisible();
    expect(screen.getByPlaceholderText("Find")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("starts open with the search the page kept, as after a tab switch", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <SearchToggle value="kai" onChange={onChange} placeholder="Find" />,
    );

    expect(screen.getByPlaceholderText("Find")).not.toHaveAttribute(
      "aria-hidden",
    );
    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
