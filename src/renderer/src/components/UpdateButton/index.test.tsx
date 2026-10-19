import { APP_EVENTS, UpdateStatus } from "@/common/types";
import { sentEvents } from "@test/ipc";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UpdateButton } from ".";

const ready: UpdateStatus = { state: "ready", version: "1.2.0" };
const manual: UpdateStatus = {
  state: "available",
  version: "1.2.0",
  manual: true,
  url: "https://github.com/tokio-app/tokio/releases/tag/v1.2.0",
};

const restart = () => screen.getByRole("button", { name: "Restart to update" });

describe("UpdateButton", () => {
  it.each<UpdateStatus>([
    { state: "idle" },
    { state: "unsupported" },
    { state: "checking" },
    { state: "none", checkedAt: 0 },
    { ...manual, manual: false },
    { state: "downloading", version: "1.2.0", percent: 40 },
  ])("renders nothing while $state", (status) => {
    const { container } = render(
      <UpdateButton status={status} connected={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers a restart once the update is ready", () => {
    render(<UpdateButton status={ready} connected={false} />);

    expect(restart()).toHaveAttribute("title", "Tokio 1.2.0");
  });

  it("offers the download when the update can't be installed by the app", () => {
    render(<UpdateButton status={manual} connected={false} />);

    expect(
      screen.getByRole("button", { name: "Download update" }),
    ).toHaveAttribute("title", "Tokio 1.2.0");
  });

  it("restarts right away while disconnected", async () => {
    const user = userEvent.setup();
    render(<UpdateButton status={ready} connected={false} />);

    await user.click(restart());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sentEvents()).toEqual([APP_EVENTS.INSTALL_UPDATE]);
  });

  it("opens the release page right away, even while connected", async () => {
    const user = userEvent.setup();
    render(<UpdateButton status={manual} connected />);

    await user.click(screen.getByRole("button", { name: "Download update" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sentEvents()).toEqual([APP_EVENTS.INSTALL_UPDATE]);
  });

  it("asks before restarting while connected, and Restart installs", async () => {
    const user = userEvent.setup();
    const { container } = render(<UpdateButton status={ready} connected />);

    await user.click(restart());

    const dialog = screen.getByRole("dialog");
    expect(container).not.toContainElement(dialog);
    expect(
      within(dialog).getByRole("heading", { name: "Restart to update?" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Tokio will disconnect from the LIVE.");
    expect(sentEvents()).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Restart" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sentEvents()).toEqual([APP_EVENTS.INSTALL_UPDATE]);
  });

  it("closes the question on Cancel without installing", async () => {
    const user = userEvent.setup();
    render(<UpdateButton status={ready} connected />);

    await user.click(restart());
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sentEvents()).toEqual([]);
  });
});
