import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServerSection } from "./ServerSection";

const render = (addresses: string[] | null) =>
  renderWithProviders(
    <ServerSection enabled addresses={addresses} onChange={() => {}} />,
  );

const field = () =>
  within(screen.getByRole("group", { name: /Network address/ }));

describe("ServerSection", () => {
  it("shows nothing of the addresses until main answers", () => {
    render(null);

    expect(
      screen.queryByRole("group", { name: /Network address/ }),
    ).not.toBeInTheDocument();
  });

  it("shows each of this PC's network addresses, for tokio-app.local, to copy", async () => {
    const { user } = render(["192.168.1.10", "172.20.0.1"]);

    expect(
      screen.getByText("(for a streaming app on another computer)"),
    ).toBeVisible();
    const copies = field().getAllByTitle("Copy address");
    expect(copies.map((c) => c.textContent)).toEqual([
      "192.168.1.10",
      "172.20.0.1",
    ]);

    // The IP alone, for a hosts file or a DNS entry
    await user.click(copies[0]);
    expect(await navigator.clipboard.readText()).toBe("192.168.1.10");
  });

  it("says when the PC has no network address", () => {
    render([]);

    expect(field().getByText("No network address found.")).toBeVisible();
    expect(field().queryByTitle("Copy address")).not.toBeInTheDocument();
  });
});
