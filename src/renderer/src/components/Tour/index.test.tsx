import { APP_EVENTS_RESPONSE } from "@/common/types";
import { EULER_SIGNUP_URL } from "@/common/util";
import { profileReply } from "@test/fixtures";
import { send } from "@test/ipc";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tour } from ".";

const TITLES = [
  "Welcome to Tokio",
  "Overlays",
  "TTS",
  "Alerts",
  "Music",
  "Games",
  "Tools",
  "Settings",
  "Active features",
  "Connect to your LIVE",
];

const card = () => within(screen.getByRole("dialog"));

describe("Tour", () => {
  it("shows its steps one at a time, then closes on Done", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour onClose={onClose} />);

    for (const [i, title] of TITLES.entries()) {
      expect(screen.getByRole("dialog", { name: title })).toBeVisible();
      expect(card().getByText(`${i + 1} of 10`)).toBeVisible();
      if (i < TITLES.length - 1) {
        await user.click(card().getByRole("button", { name: "Next" }));
      }
    }

    expect(onClose).not.toHaveBeenCalled();
    await user.click(card().getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("starts on Next, and gives Next the focus when Back leaves", async () => {
    const user = userEvent.setup();
    render(<Tour onClose={vi.fn()} />);
    const next = () => card().getByRole("button", { name: "Next" });

    expect(next()).toHaveFocus();
    expect(
      card().queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();

    await user.click(next());
    await user.click(card().getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("dialog", { name: "Welcome to Tokio" }),
    ).toBeVisible();
    expect(next()).toHaveFocus();
  });

  it("closes from its close button or Escape on any step", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour onClose={onClose} />);

    await user.click(card().getByRole("button", { name: "Next" }));
    await user.click(card().getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("follows the profile's platforms from the replies Home gets", async () => {
    const user = userEvent.setup();
    render(<Tour onClose={vi.fn()} />);
    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.platforms = ["kick"];
      }),
    );

    while (!screen.queryByRole("dialog", { name: "Settings" })) {
      await user.click(card().getByRole("button", { name: "Next" }));
    }
    expect(card().queryByRole("link")).toBeNull();
    expect(
      card().getByText(/^Change Tokio's language, turn on the overlay server/),
    ).toBeVisible();

    await send(APP_EVENTS_RESPONSE.SET_PLATFORMS, {
      success: true,
      platforms: ["kick", "twitch"],
    });
    expect(
      card().getByText("Sign in to Twitch here before you connect it."),
    ).toBeVisible();

    while (!screen.queryByRole("dialog", { name: "Connect to your LIVE" })) {
      await user.click(card().getByRole("button", { name: "Next" }));
    }
    expect(
      card().getByText(
        "Each platform you stream to gets a tab here, and the + adds another. Twitch's tab connects once you sign in to Twitch in Settings. In Kick's tab, type your channel. Once you're live, click Connect. You can take this tour again from About.",
      ),
    ).toBeVisible();
  });

  it("starts from the first-start dialog's platform and what it did, then follows the replies", async () => {
    const user = userEvent.setup();
    render(
      <Tour onClose={vi.fn()} platforms={["twitch"]} done={{ twitch: true }} />,
    );

    while (!screen.queryByRole("dialog", { name: "Settings" })) {
      await user.click(card().getByRole("button", { name: "Next" }));
    }
    expect(
      card().getByText(/^Change Tokio's language, turn on the overlay server/),
    ).toBeVisible();

    await send(APP_EVENTS_RESPONSE.SET_PLATFORMS, {
      success: true,
      platforms: ["tiktok"],
    });
    expect(card().getByRole("link", { name: "Get a free key" })).toBeVisible();
  });

  it("links the Settings step to Euler Stream's sign-up", async () => {
    const user = userEvent.setup();
    render(<Tour onClose={vi.fn()} />);

    while (!screen.queryByRole("dialog", { name: "Settings" })) {
      await user.click(card().getByRole("button", { name: "Next" }));
    }

    expect(
      card().getByRole("link", { name: "Get a free key" }),
    ).toHaveAttribute("href", EULER_SIGNUP_URL);
  });
});
