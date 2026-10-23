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
  it("shows a link at each of this PC's network addresses, to copy", async () => {
    const { user } = render();
    expect(sent(APP_EVENTS.GET_NETWORK_ADDRESSES)).toHaveLength(1);
    expect(
      screen.queryByRole("group", { name: /Network address/ }),
    ).not.toBeInTheDocument();

    await addresses("192.168.1.10", "172.20.0.1");

    expect(screen.getByText("(for OBS on another computer)")).toBeVisible();
    const links = field().getAllByTitle("Copy URL");
    expect(links.map((l) => l.textContent)).toEqual([
      "http://192.168.1.10:37891/",
      "http://172.20.0.1:37891/",
    ]);

    await user.click(links[0]);
    expect(await navigator.clipboard.readText()).toBe(
      "http://192.168.1.10:37891/",
    );
  });

  it("says when the PC has no network address", async () => {
    render();

    await addresses();

    expect(field().getByText("No network address found.")).toBeVisible();
    expect(field().queryByTitle("Copy URL")).not.toBeInTheDocument();
  });
});
