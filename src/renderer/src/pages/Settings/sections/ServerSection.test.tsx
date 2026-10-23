import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServerSection } from "./ServerSection";

const render = () =>
  renderWithProviders(<ServerSection enabled onChange={() => {}} />);

const addresses = (...list: string[]) =>
  send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, { addresses: list });

const field = () =>
  within(screen.getByRole("group", { name: /Network address/ }));

describe("ServerSection", () => {
  it("shows each of this PC's network addresses, for tokio-app.local, to copy", async () => {
    const { user } = render();
    expect(sent(APP_EVENTS.GET_NETWORK_ADDRESSES)).toHaveLength(1);
    expect(
      screen.queryByRole("group", { name: /Network address/ }),
    ).not.toBeInTheDocument();

    await addresses("192.168.1.10", "172.20.0.1");

    expect(
      screen.getByText("(for tokio-app.local on another computer)"),
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

  it("says when the PC has no network address", async () => {
    render();

    await addresses();

    expect(field().getByText("No network address found.")).toBeVisible();
    expect(field().queryByTitle("Copy address")).not.toBeInTheDocument();
  });
});
