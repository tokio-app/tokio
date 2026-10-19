import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure, profileReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Music } from ".";

const loaded = profileReply((p) => {
  p.music.provider = { name: "Spotify", key: "client-id" };
  p.music.controls.play = { enabled: false, command: "!song" };
  p.music.protection = { cooldown: 4, queue_length: 15 };
  p.music.permissions.followers = true;
});

const youtube = profileReply();

// The field under a label: the label and its control share a div
const field = (label: string) =>
  within(screen.getByText(label).closest("div")!);

const saveButton = () => screen.getByRole("button", { name: "Save changes" });
const tab = (name: string) => screen.getByRole("tab", { name });
const clientId = () =>
  screen.getByPlaceholderText("Enter your Spotify Client ID...");
const connectButton = () => screen.getByRole("button", { name: "Connect" });

async function setup(reply = loaded) {
  const app = renderWithProviders(<Music />);
  await send(APP_EVENTS_RESPONSE.GET_PROFILE, reply);
  return app;
}

type User = Awaited<ReturnType<typeof setup>>["user"];

// Saves, and returns what was sent: the draft
async function draft(user: User) {
  await user.click(saveButton());
  return sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS).at(-1)!.settings;
}

const musicConnected = (success = true) =>
  send(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, { success });

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
    expect((await draft(user)).provider).toEqual({ name: "Spotify", key: "" });

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
    expect((await draft(user)).provider).toEqual({
      name: "Spotify",
      key: "my-client",
    });
  });

  it("saves, then connects with the provider, loading until main answers", async () => {
    const { user } = await setup(youtube);
    const connect = connectButton();
    await user.click(tab("Spotify"));
    await user.type(clientId(), "my-client");

    await user.click(connect);

    const events = sentEvents();
    expect(events.indexOf(APP_EVENTS.UPDATE_MUSIC_SETTINGS)).toBeLessThan(
      events.indexOf(APP_EVENTS.CONNECT_MUSIC),
    );
    expect(sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS)[0].settings.provider).toEqual(
      { name: "Spotify", key: "my-client" },
    );
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

    expect((await draft(user)).controls).toEqual({
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

    const saved = await draft(user);
    expect(saved.permissions.superfans).toBe(true);
    expect(saved.protection).toEqual({ cooldown: 10, queue_length: 2 });
    expect(
      section("Protection").queryByText("Max Comment Length"),
    ).not.toBeInTheDocument();
  });

  it("saves the draft once something changed", async () => {
    const { user } = await setup();
    expect(saveButton()).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Last" }));
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
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

    await send(APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS, { success: true });
    expect(saveButton()).toBeDisabled();
  });

  it("keeps the save button when saving fails", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("checkbox", { name: "Last" }));

    await user.click(saveButton());
    await send(APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS, failure());

    expect(saveButton()).toBeEnabled();
  });
});
