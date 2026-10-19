import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { send, sent } from "@test/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("music window", () => {
  it("has a title bar that controls the music window", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    expect(sent(APP_EVENTS.MINIMIZE_MUSIC_WINDOW)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.RESIZE_MUSIC_WINDOW, { state: "maximized" });
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });
});
