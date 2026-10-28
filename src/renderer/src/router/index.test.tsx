import { renderApp } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/pages/About", () => ({
  About: () => {
    throw new Error("Broken page");
  },
}));

describe("router", () => {
  it("shows a page's error inside the page, keeping the sidebar", async () => {
    await renderApp("/about");

    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("says when a page doesn't exist", async () => {
    await renderApp("/nowhere");

    expect(screen.getByText("Not Found")).toBeInTheDocument();
  });
});
