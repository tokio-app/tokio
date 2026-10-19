import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { profileReply, settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Home } from ".";

const connected = (stats = { views: 1234, viewers: 12, likes: 5 }) =>
  send(APP_EVENTS_RESPONSE.CONNECTED, { success: true, stats });

const username = () => screen.getByPlaceholderText("@username");
// The value shown above a stat's label
const stat = (label: string) => screen.getByText(label).previousElementSibling;

describe("Home", () => {
  it("asks main for the profile, the settings and the connection", () => {
    renderWithProviders(<Home />);

    expect(sentEvents()).toEqual([
      APP_EVENTS.GET_PROFILE,
      APP_EVENTS.GET_SETTINGS,
      APP_EVENTS.IS_CONNECTED,
    ]);
  });

  it("fills in the saved username and features", async () => {
    renderWithProviders(<Home />);

    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.connector.username = "@streamer";
      }),
    );
    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.activeFeatures = { tts: true, music: false, alerts: true };
      }),
    );

    expect(username()).toHaveValue("@streamer");
    expect(screen.getByRole("checkbox", { name: "TTS" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Music" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Alerts" })).toBeChecked();
  });

  it("connects with the username, loading until main answers", async () => {
    const { user } = renderWithProviders(<Home />);
    const connect = screen.getByRole("button", { name: "Connect" });

    await user.type(username(), "@streamer");
    await user.click(connect);

    expect(sent(APP_EVENTS.CONNECT)).toEqual([{ username: "@streamer" }]);
    expect(connect).toHaveAttribute("aria-busy", "true");

    await connected();

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(username()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("doesn't connect without a username", async () => {
    const { user } = renderWithProviders(<Home />);
    const connect = screen.getByRole("button", { name: "Connect" });

    await user.click(connect);
    await user.type(username(), "@ ");
    await user.click(connect);

    expect(sent(APP_EVENTS.CONNECT)).toEqual([]);
    expect(connect).not.toHaveAttribute("aria-busy");
  });

  it("disconnects, loading until main answers", async () => {
    const { user } = renderWithProviders(<Home />);
    await connected();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(sent(APP_EVENTS.DISCONNECT)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.CONNECTED, {
      success: false,
      stats: { views: 0, viewers: 0, likes: 0 },
    });

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(username()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("turns features on and off", async () => {
    const { user } = renderWithProviders(<Home />);
    const music = screen.getByRole("checkbox", { name: "Music" });

    await user.click(music);
    expect(music).toBeChecked();

    await user.click(music);
    expect(music).not.toBeChecked();

    expect(sent(APP_EVENTS.ACTIVE_FEATURES)).toEqual([
      { music: true },
      { music: false },
    ]);
  });

  it("shows dashes for the stats while offline", () => {
    renderWithProviders(<Home />);

    for (const label of ["Viewers", "Likes", "Total Views"]) {
      expect(stat(label)).toHaveTextContent("--");
    }
  });

  it("shows the live stats short, with the exact number on hover", async () => {
    renderWithProviders(<Home />);
    await connected();

    expect(stat("Viewers")).toHaveTextContent("12");
    expect(stat("Likes")).toHaveTextContent("5");
    expect(stat("Total Views")).toHaveTextContent("1.2K");
    expect(stat("Total Views")).toHaveAttribute("title", "1,234");

    await send(APP_EVENTS_RESPONSE.VIEWS, {
      data: { viewers: 40, views: 2000 },
    });
    await send(APP_EVENTS_RESPONSE.LIKES, { likes: 99 });

    expect(stat("Viewers")).toHaveTextContent("40");
    expect(stat("Total Views")).toHaveTextContent("2K");
    expect(stat("Likes")).toHaveTextContent("99");
  });
});
