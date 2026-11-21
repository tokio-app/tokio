import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TwitchSection } from "./TwitchSection";

const dialog = () => within(screen.getByRole("dialog"));

const code = () =>
  send(APP_EVENTS_RESPONSE.TWITCH_CODE, {
    code: "ABCD1234",
    uri: "https://www.twitch.tv/activate?device-code=ABCD1234",
    expiresAt: Date.now() + 1_800_000,
  });

describe("TwitchSection", () => {
  it("signs in with a code kept hidden until Show", async () => {
    const { user } = renderWithProviders(<TwitchSection login="" />);

    await user.click(
      screen.getByRole("button", { name: "Sign in with Twitch" }),
    );

    expect(sent(APP_EVENTS.TWITCH_SIGN_IN)).toHaveLength(1);
    expect(dialog().getByRole("status", { name: "Loading" })).toBeVisible();

    await code();

    expect(dialog().queryByText("ABCD1234")).not.toBeInTheDocument();
    expect(dialog().getByText("••••••••")).toBeVisible();
    expect(
      dialog().getByRole("link", { name: "Open Twitch again" }),
    ).toHaveAttribute(
      "href",
      "https://www.twitch.tv/activate?device-code=ABCD1234",
    );

    await user.click(dialog().getByRole("button", { name: "Show" }));
    expect(dialog().getByText("ABCD1234")).toBeVisible();

    await user.click(dialog().getByRole("button", { name: "Hide" }));
    expect(dialog().queryByText("ABCD1234")).not.toBeInTheDocument();

    // Signed in, or failed with main's notice: the wait is over
    await send(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, {
      success: true,
      login: "streamer_tv",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels the sign-in waiting", async () => {
    const { user } = renderWithProviders(<TwitchSection login="" />);

    await user.click(
      screen.getByRole("button", { name: "Sign in with Twitch" }),
    );
    await code();
    await user.click(dialog().getByRole("button", { name: "Cancel" }));

    expect(sent(APP_EVENTS.TWITCH_SIGN_OUT)).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("starts a new sign-in without the last one's code", async () => {
    const { user } = renderWithProviders(<TwitchSection login="" />);
    const signIn = () =>
      user.click(screen.getByRole("button", { name: "Sign in with Twitch" }));

    await signIn();
    await code();
    await user.click(dialog().getByRole("button", { name: "Cancel" }));
    await signIn();

    expect(dialog().getByRole("status", { name: "Loading" })).toBeVisible();
  });

  it("shows the account signed in to, and signs out", async () => {
    const { user } = renderWithProviders(<TwitchSection login="streamer_tv" />);

    expect(screen.getByText("Signed in as @streamer_tv")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sign in with Twitch" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(sent(APP_EVENTS.TWITCH_SIGN_OUT)).toHaveLength(1);
  });
});
