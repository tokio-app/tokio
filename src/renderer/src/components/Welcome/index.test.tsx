import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { EULER_SIGNUP_URL } from "@/common/util";
import { settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Welcome } from ".";

const dialog = () =>
  within(screen.getByRole("dialog", { name: "Set up your stream" }));
const saveButton = () => dialog().getByRole("button", { name: "Save" });
const field = (name: string) =>
  within(dialog().getByRole("group", { name })).getByRole("textbox");
const platform = (name: string) => dialog().getByRole("radio", { name });

// Layout's reply, which names the profile and the connector
const loaded = () =>
  send(
    APP_EVENTS_RESPONSE.GET_SETTINGS,
    settingsReply((s) => {
      s.settings.activeConnProvider = { name: "Euler", key: "" };
    }),
  );

// What the dialog sent main, in order
const requests = () =>
  sentEvents().filter((e) => e !== APP_EVENTS.TWITCH_SIGN_IN);

function setup() {
  const onClose = vi.fn();
  const app = renderWithProviders(<Welcome onClose={onClose} />);
  return { ...app, onClose };
}

describe("Welcome", () => {
  it("starts on TikTok, with its username, the optional key and the profile's name", async () => {
    setup();

    expect(platform("TikTok")).toBeChecked();
    expect(
      dialog().getByRole("radiogroup", { name: "Platform" }),
    ).toBeVisible();
    expect(dialog().getByPlaceholderText("@username")).toBeVisible();
    expect(
      dialog().getByRole("group", { name: /^Euler Stream API key/ }),
    ).toBeVisible();
    expect(
      dialog().getByRole("link", { name: "Get a free key" }),
    ).toHaveAttribute("href", EULER_SIGNUP_URL);
    expect(dialog().getByText("(optional)")).toBeVisible();
    expect(dialog().getByText(/or add it later in Settings\.$/)).toBeVisible();
    // Never the tour's title, which App.test.tsx and e2e look for
    expect(
      screen.queryByRole("dialog", { name: "Welcome to Tokio" }),
    ).toBeNull();

    // Until Layout's GET_SETTINGS says which profile it is: never asked here
    expect(sent(APP_EVENTS.GET_SETTINGS)).toEqual([]);
    expect(saveButton()).toBeDisabled();
    await loaded();
    expect(field("Profile name")).toHaveValue("Default");
    expect(saveButton()).toBeEnabled();
  });

  it("asks each platform for its own field", async () => {
    const { user } = setup();

    await user.click(platform("YouTube"));
    expect(
      dialog().getByPlaceholderText("@channel or LIVE link"),
    ).toBeVisible();
    expect(
      dialog().queryByRole("group", { name: /Euler Stream API key/ }),
    ).toBeNull();

    await user.click(platform("Kick"));
    expect(
      dialog().getByPlaceholderText("Channel or kick.com link"),
    ).toBeVisible();

    await user.click(platform("Twitch"));
    expect(
      dialog().getByRole("button", { name: "Sign in with Twitch" }),
    ).toBeVisible();
  });

  it("picks the platform with the arrow keys, as one choice", async () => {
    const { user } = setup();

    await user.click(platform("TikTok"));
    await user.keyboard("{ArrowRight}");

    expect(platform("Twitch")).toBeChecked();
    expect(platform("Twitch")).toHaveFocus();
    expect(platform("TikTok")).not.toBeChecked();
    expect(
      dialog().getByRole("button", { name: "Sign in with Twitch" }),
    ).toBeVisible();
  });

  it("saves on Enter in a field, and not while Save is off", async () => {
    const { user, onClose } = setup();

    await user.type(dialog().getByPlaceholderText("@username"), "@me{Enter}");
    expect(requests()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();

    await loaded();
    await user.type(dialog().getByPlaceholderText("@username"), "{Enter}");

    expect(sent(APP_EVENTS.SET_CHANNELS)).toEqual([{ username: "@me" }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("can't save a profile name under three characters", async () => {
    const { user } = setup();
    await loaded();

    await user.clear(field("Profile name"));
    await user.type(field("Profile name"), " ab ");
    expect(saveButton()).toBeDisabled();
    await user.click(saveButton());
    expect(requests()).toEqual([]);

    await user.type(field("Profile name"), "c");
    expect(saveButton()).toBeEnabled();
  });

  it("saves TikTok's username, the key and the new name", async () => {
    const { user, onClose } = setup();
    await loaded();

    await user.type(dialog().getByPlaceholderText("@username"), " @me ");
    await user.type(
      dialog().getByLabelText("Euler Stream API key"),
      "euler-key",
    );
    await user.clear(field("Profile name"));
    await user.type(field("Profile name"), "My stream");
    await user.click(saveButton());

    expect(sent(APP_EVENTS.SET_PLATFORMS)).toEqual([]);
    expect(sent(APP_EVENTS.SET_CHANNELS)).toEqual([{ username: "@me" }]);
    expect(sent(APP_EVENTS.SET_PROVIDER)).toEqual([
      { name: "Euler", key: "euler-key", type: "connector" },
    ]);
    expect(sent(APP_EVENTS.RENAME_PROFILE)).toEqual([
      { file: "default.json", name: "My stream" },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends nothing that didn't change", async () => {
    const { user, onClose } = setup();
    await loaded();

    await user.type(field("Profile name"), " ");
    await user.click(saveButton());

    expect(requests()).toEqual([]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("saves another platform with its channel, and no key typed for TikTok", async () => {
    const { user, onClose } = setup();
    await loaded();

    await user.type(
      dialog().getByLabelText("Euler Stream API key"),
      "euler-key",
    );
    await user.click(platform("YouTube"));
    await user.type(
      dialog().getByPlaceholderText("@channel or LIVE link"),
      "@mychannel",
    );
    await user.click(saveButton());

    expect(requests()).toEqual([
      APP_EVENTS.SET_PLATFORMS,
      APP_EVENTS.SET_CHANNELS,
    ]);
    expect(sent(APP_EVENTS.SET_PLATFORMS)).toEqual([
      { platforms: ["youtube"] },
    ]);
    expect(sent(APP_EVENTS.SET_CHANNELS)).toEqual([
      { channels: { youtube: "@mychannel" } },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("signs in to Twitch inside it, then gives Save the focus", async () => {
    const { user, onClose } = setup();
    await loaded();
    await user.click(platform("Twitch"));

    await user.click(
      dialog().getByRole("button", { name: "Sign in with Twitch" }),
    );
    expect(sent(APP_EVENTS.TWITCH_SIGN_IN)).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    await send(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, {
      success: true,
      login: "streamer_tv",
    });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog().getByText("Signed in as @streamer_tv")).toBeVisible();
    expect(saveButton()).toHaveFocus();

    await user.click(saveButton());
    expect(requests()).toEqual([APP_EVENTS.SET_PLATFORMS]);
    expect(sent(APP_EVENTS.SET_PLATFORMS)).toEqual([{ platforms: ["twitch"] }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the account already signed in to", async () => {
    const { user } = setup();
    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.accounts.twitch.login = "streamer_tv";
      }),
    );

    await user.click(platform("Twitch"));

    expect(dialog().getByText("Signed in as @streamer_tv")).toBeVisible();
  });

  it("keeps the name being typed when the settings come again", async () => {
    const { user } = setup();
    await loaded();

    await user.type(field("Profile name"), " 2");
    await loaded();

    expect(field("Profile name")).toHaveValue("Default 2");
  });

  const leaves = [
    [
      "Skip",
      async (user: ReturnType<typeof setup>["user"]) =>
        user.click(dialog().getByRole("button", { name: "Skip" })),
    ],
    [
      "the close button",
      async (user: ReturnType<typeof setup>["user"]) =>
        user.click(dialog().getByRole("button", { name: "Close" })),
    ],
    [
      "Escape",
      async (user: ReturnType<typeof setup>["user"]) =>
        user.keyboard("{Escape}"),
    ],
  ] as const;

  it.each(leaves)(
    "closes at once on %s when nothing was typed",
    async (_, leave) => {
      const { user, onClose } = setup();
      await loaded();
      await user.click(platform("Kick"));

      await leave(user);

      expect(screen.queryByRole("dialog", { name: "Skip setup?" })).toBeNull();
      expect(requests()).toEqual([]);
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it.each(leaves)(
    "asks before %s drops what was typed, and sends nothing",
    async (_, leave) => {
      const { user, onClose } = setup();
      await loaded();
      await user.click(platform("Kick"));
      await user.type(
        dialog().getByPlaceholderText("Channel or kick.com link"),
        "westcol",
      );

      await leave(user);
      const ask = () =>
        within(screen.getByRole("dialog", { name: "Skip setup?" }));
      expect(ask().getByText("What you typed won't be saved.")).toBeVisible();
      expect(onClose).not.toHaveBeenCalled();

      // Cancel keeps it all to finish
      await user.click(ask().getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Skip setup?" })).toBeNull();
      expect(
        dialog().getByPlaceholderText("Channel or kick.com link"),
      ).toHaveValue("westcol");

      await leave(user);
      await user.click(ask().getByRole("button", { name: "Skip" }));

      expect(requests()).toEqual([]);
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("asks before dropping a new profile name", async () => {
    const { user, onClose } = setup();
    await loaded();

    await user.type(field("Profile name"), " 2");
    await user.click(dialog().getByRole("button", { name: "Skip" }));

    expect(screen.getByRole("dialog", { name: "Skip setup?" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});
