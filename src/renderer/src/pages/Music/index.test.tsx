import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Music } from ".";

const loaded = profileReply((p) => {
  p.music.provider = { name: "Spotify", key: "client-id" };
  p.music.controls.play = { enabled: false, command: "!song" };
  p.music.protection = {
    cooldown: 4,
    queue_length: 15,
    one_per_viewer: false,
  };
  p.music.permissions.followers = true;
});

const youtube = profileReply();

// The field under a label: the label and its control share a div
const field = (label: string) =>
  within(screen.getByText(label).closest("div")!);

const tab = (name: string) => screen.getByRole("tab", { name });
const clientId = () =>
  screen.getByPlaceholderText("Enter your Spotify Client ID...");
const connectButton = () => screen.getByRole("button", { name: "Connect" });

async function setup(reply = loaded) {
  const app = renderWithProviders(<Music />, {
    user: { advanceTimers: (ms) => vi.advanceTimersByTime(ms) },
  });
  await send(APP_EVENTS_RESPONSE.GET_PROFILE, reply);
  return app;
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

// The settings saved once the changes settle
async function saved() {
  await wait(300);
  return sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS).at(-1)!.settings;
}

const musicConnected = (success = true) =>
  send(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, { success });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Music", () => {
  it("asks main for the profile and whether music is connected", () => {
    renderWithProviders(<Music />);

    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
    expect(sent(APP_EVENTS.IS_MUSIC_CONNECTED)).toHaveLength(1);
  });

  it("fills in the loaded settings", async () => {
    await setup();

    expect(tab("Spotify")).toHaveAttribute("aria-selected", "true");
    expect(tab("YouTube")).toHaveAttribute("aria-selected", "false");
    expect(clientId()).toHaveValue("client-id");
    expect(screen.getByText("Disconnected")).toBeInTheDocument();

    expect(screen.getByRole("checkbox", { name: "Play" })).not.toBeChecked();
    expect(screen.getByPlaceholderText("!play")).toHaveValue("!song");
    expect(screen.getByPlaceholderText("!play")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Next" })).toBeChecked();
    expect(screen.getByPlaceholderText("!next")).toHaveValue("!next");
    expect(screen.getByPlaceholderText("!next")).toBeEnabled();

    expect(
      screen.getByRole("checkbox", { name: "Followers Only" }),
    ).toBeChecked();
    expect(field("Cooldown").getByRole("spinbutton")).toHaveValue(4);
    expect(field("Max Queue Length").getByRole("spinbutton")).toHaveValue(15);
  });

  it("switches the provider with the tabs", async () => {
    const { user } = await setup(youtube);
    expect(tab("YouTube")).toHaveAttribute("aria-selected", "true");

    await user.click(tab("Spotify"));

    expect(tab("Spotify")).toHaveAttribute("aria-selected", "true");
    expect((await saved()).provider).toEqual({ name: "Spotify", key: "" });

    await user.click(tab("YouTube"));
    expect(tab("YouTube")).toHaveAttribute("aria-selected", "true");
  });

  it("needs a Spotify Client ID to connect to Spotify", async () => {
    const { user } = await setup(youtube);
    expect(connectButton()).toBeEnabled();

    await user.click(tab("Spotify"));
    expect(screen.getByText("Spotify Client ID")).toBeInTheDocument();
    expect(connectButton()).toBeDisabled();

    await user.type(clientId(), "my-client");
    expect(connectButton()).toBeEnabled();
    expect((await saved()).provider).toEqual({
      name: "Spotify",
      key: "my-client",
    });
  });

  // Only CSS hides it while YouTube is selected
  it("keeps the hidden Client ID out of the keyboard's reach", async () => {
    const { user } = await setup(youtube);
    const connect = connectButton();

    const reached: Element[] = [];
    while (document.activeElement !== connect && reached.length < 50) {
      await user.tab();
      reached.push(document.activeElement!);
    }

    expect(reached).toContain(connect);
    expect(reached).not.toContain(clientId());
  });

  it("connects with the provider shown, loading until main answers", async () => {
    const { user } = await setup(youtube);
    const connect = connectButton();
    await user.click(tab("Spotify"));
    await user.type(clientId(), "my-client");

    await user.click(connect);

    expect(sent(APP_EVENTS.CONNECT_MUSIC)).toEqual([
      { name: "Spotify", key: "my-client" },
    ]);
    expect(connect).toHaveAttribute("aria-busy", "true");

    await musicConnected();

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(clientId()).toBeDisabled();
    expect(connect).toHaveTextContent("Disconnect");
    expect(connect).not.toHaveAttribute("aria-busy");
  });

  it("stops loading when the connection fails", async () => {
    const { user } = await setup();
    const connect = connectButton();

    await user.click(connect);
    await musicConnected(false);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(connect).toHaveTextContent("Connect");
    expect(connect).not.toHaveAttribute("aria-busy");
  });

  it("disconnects while connected", async () => {
    const { user } = await setup();
    await musicConnected();
    const disconnect = screen.getByRole("button", { name: "Disconnect" });

    await user.click(disconnect);

    expect(sent(APP_EVENTS.DISCONNECT_MUSIC)).toHaveLength(1);
    expect(sent(APP_EVENTS.CONNECT_MUSIC)).toEqual([]);
    expect(disconnect).toHaveAttribute("aria-busy", "true");

    await musicConnected(false);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(clientId()).toBeEnabled();
    expect(disconnect).toHaveTextContent("Connect");
  });

  it("turns a control's command on and off, and edits it", async () => {
    const { user } = await setup();
    const play = screen.getByPlaceholderText("!play");

    await user.click(screen.getByRole("checkbox", { name: "Play" }));
    expect(play).toBeEnabled();
    await user.clear(play);
    await user.type(play, "!sr");

    await user.click(screen.getByRole("checkbox", { name: "Revoke" }));
    expect(screen.getByPlaceholderText("!revoke")).toBeDisabled();

    expect((await saved()).controls).toEqual({
      play: { enabled: true, command: "!sr" },
      next: { enabled: true, command: "!next" },
      last: { enabled: true, command: "!last" },
      revoke: { enabled: false, command: "!revoke" },
    });
  });

  it("changes who may request songs and the limits", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("checkbox", { name: "Superfans Only" }));
    fireEvent.change(field("Cooldown").getByRole("spinbutton"), {
      target: { value: "10" },
    });
    fireEvent.change(field("Max Queue Length").getByRole("spinbutton"), {
      target: { value: "2" },
    });

    const settings = await saved();
    expect(settings.permissions.superfans).toBe(true);
    expect(settings.protection).toEqual({
      cooldown: 10,
      queue_length: 2,
      one_per_viewer: false,
    });
    expect(
      section("Protection").queryByText("Max Comment Length"),
    ).not.toBeInTheDocument();
  });

  it("saves the one request per viewer protection", async () => {
    const { user } = await setup();
    const check = screen.getByRole("checkbox", {
      name: "One request per viewer",
    });
    expect(check).not.toBeChecked();

    await user.click(check);

    expect(check).toBeChecked();
    expect((await saved()).protection.one_per_viewer).toBe(true);
  });

  it("saves a change 300ms later", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("checkbox", { name: "Last" }));
    await wait(299);
    expect(sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS)).toEqual([]);

    await wait(1);
    expect(sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS)).toEqual([
      {
        settings: {
          ...loaded.profile.music,
          controls: {
            ...loaded.profile.music.controls,
            last: { enabled: false, command: "!last" },
          },
        },
      },
    ]);
  });
});
