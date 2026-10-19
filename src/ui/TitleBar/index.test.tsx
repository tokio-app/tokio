import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { listeners, send, sentEvents } from "@test/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TitleBar } from ".";

async function clickControls() {
  const user = userEvent.setup();
  for (const name of ["Minimize", "Maximize", "Close"]) {
    await user.click(screen.getByRole("button", { name }));
  }
}

describe("TitleBar", () => {
  it("controls the main window", async () => {
    render(<TitleBar target="main" logo="logo.png" />);

    await clickControls();

    expect(sentEvents()).toEqual([
      APP_EVENTS.MINIMIZE_WINDOW,
      APP_EVENTS.MAXIMIZE_WINDOW,
      APP_EVENTS.CLOSE_WINDOW,
    ]);
  });

  it("controls the music window", async () => {
    render(<TitleBar target="music" logo="logo.png" compact />);

    await clickControls();

    expect(sentEvents()).toEqual([
      APP_EVENTS.MINIMIZE_MUSIC_WINDOW,
      APP_EVENTS.MAXIMIZE_MUSIC_WINDOW,
      APP_EVENTS.CLOSE_MUSIC_WINDOW,
    ]);
  });

  it("offers Restore while its own window is maximized", async () => {
    render(<TitleBar target="main" logo="logo.png" />);

    await send(APP_EVENTS_RESPONSE.RESIZE_MUSIC_WINDOW, { state: "maximized" });
    expect(
      screen.getByRole("button", { name: "Maximize" }),
    ).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.RESIZE_WINDOW, { state: "maximized" });
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.RESIZE_WINDOW, { state: "normal" });
    expect(
      screen.getByRole("button", { name: "Maximize" }),
    ).toBeInTheDocument();
  });

  it("shows the logo, and its children before the controls", () => {
    render(
      <TitleBar target="main" logo="logo.png">
        <span>Profiles</span>
      </TitleBar>,
    );

    expect(screen.getByRole("img")).toHaveAttribute("src", "logo.png");
    expect(
      screen
        .getByText("Profiles")
        .compareDocumentPosition(
          screen.getByRole("button", { name: "Minimize" }),
        ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<TitleBar target="main" logo="logo.png" />);
    expect(listeners(APP_EVENTS_RESPONSE.RESIZE_WINDOW)).toBe(1);

    unmount();

    expect(listeners(APP_EVENTS_RESPONSE.RESIZE_WINDOW)).toBe(0);
  });
});
