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
    // React logs the error the page throws, and the router warns about it
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await renderApp("/about");

    expect(
      screen.getByText("Tokio couldn't show this page"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Error in route match"),
    );
  });

  it("says when a page doesn't exist", async () => {
    await renderApp("/nowhere");

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
