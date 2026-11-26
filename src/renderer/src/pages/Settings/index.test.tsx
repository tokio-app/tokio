import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure, profileReply, settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { inList, section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Settings } from ".";

const profiles = settingsReply((s) => {
  s.profiles = [
    { file: "default.json", name: "Default" },
    { file: "horror.json", name: "Horror" },
  ];
  s.settings.activeProfile = { file: "horror.json", name: "Horror" };
});

const dialog = () => within(screen.getByRole("dialog"));

const serverBox = () => screen.getByRole("checkbox", { name: "Enable server" });
const connected = (success: boolean) =>
  send(APP_EVENTS_RESPONSE.CONNECTED, {
    success,
    live: success,
    stats: { views: 0, viewers: 0, likes: 0, platformViewers: {} },
  });

async function setup(reply = profiles) {
  const app = renderWithProviders(<Settings />);
  await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply);
  return app;
}

describe("Settings", () => {
  it("asks main for the settings and the connection", () => {
    renderWithProviders(<Settings />);

    expect(sent(APP_EVENTS.GET_SETTINGS)).toHaveLength(1);
    expect(sent(APP_EVENTS.IS_CONNECTED)).toHaveLength(1);
  });

  describe("Platforms", () => {
    const headings = () =>
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

    it("shows TikTok's key and chat translation, not Twitch's sign-in, on a TikTok profile", async () => {
      await setup();

      expect(headings()).toContain("TikTok LIVE");
      expect(headings()).toContain("Chat translation");
      expect(headings()).not.toContain("Twitch");
    });

    it("follows the active profile's platforms, switches included", async () => {
      await setup();

      await send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.platforms = ["twitch", "kick"];
        }),
      );
      expect(headings()).toContain("Twitch");
      expect(headings()).not.toContain("TikTok LIVE");
      expect(headings()).not.toContain("Chat translation");

      await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
      expect(headings()).toContain("TikTok LIVE");
      expect(headings()).not.toContain("Twitch");
    });
  });

  describe("Overlay server", () => {
    it("asks before enabling the server, and Cancel leaves it off", async () => {
      const { user } = await setup();

      await user.click(serverBox());
      expect(
        dialog().getByText("Enable the overlay server?"),
      ).toBeInTheDocument();
      expect(serverBox()).not.toBeChecked();

      await user.click(dialog().getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(serverBox()).not.toBeChecked();
      expect(sentEvents()).not.toContain(APP_EVENTS.REQ_FQDN);
      expect(sentEvents()).not.toContain(APP_EVENTS.SET_SERVER);
    });

    it("starts the server once main has set up its hostname", async () => {
      const { user } = await setup();

      await user.click(serverBox());
      await user.click(dialog().getByRole("button", { name: "Enable server" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(serverBox()).toBeChecked();
      expect(sent(APP_EVENTS.REQ_FQDN)).toHaveLength(1);
      expect(sent(APP_EVENTS.SET_SERVER)).toEqual([]);

      await send(APP_EVENTS_RESPONSE.REQ_FQDN, { success: true });

      expect(serverBox()).toBeChecked();
      expect(sent(APP_EVENTS.SET_SERVER)).toEqual([{ enabled: true }]);
    });

    it("turns the server back off when the hostname fails", async () => {
      const { user } = await setup();
      await user.click(serverBox());
      await user.click(dialog().getByRole("button", { name: "Enable server" }));

      await send(APP_EVENTS_RESPONSE.REQ_FQDN, failure());

      expect(serverBox()).not.toBeChecked();
      expect(sent(APP_EVENTS.SET_SERVER)).toEqual([]);
    });

    it("stops the server right away", async () => {
      const { user } = await setup(
        settingsReply((s) => {
          s.settings.server.enabled = true;
        }),
      );
      expect(serverBox()).toBeChecked();

      await user.click(serverBox());

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(serverBox()).not.toBeChecked();
      expect(sent(APP_EVENTS.SET_SERVER)).toEqual([{ enabled: false }]);
    });
  });

  describe("Updates", () => {
    it("turns automatic updates on and off", async () => {
      const { user } = await setup(
        settingsReply((s) => {
          s.settings.updates.auto = false;
        }),
      );
      const auto = screen.getByRole("checkbox", {
        name: "Check for updates automatically",
      });
      expect(auto).not.toBeChecked();

      await user.click(auto);
      expect(auto).toBeChecked();

      await user.click(auto);
      expect(auto).not.toBeChecked();

      expect(sent(APP_EVENTS.SET_AUTO_UPDATES)).toEqual([
        { enabled: true },
        { enabled: false },
      ]);
    });

    it("turns automatic official overlay updates off and on", async () => {
      const { user } = await setup();
      const overlays = screen.getByRole("checkbox", {
        name: "Update official overlays automatically",
      });
      expect(overlays).toBeChecked();

      await user.click(overlays);
      expect(overlays).not.toBeChecked();

      await user.click(overlays);
      expect(overlays).toBeChecked();

      expect(sent(APP_EVENTS.SET_OVERLAY_UPDATES)).toEqual([
        { enabled: false },
        { enabled: true },
      ]);
      expect(sent(APP_EVENTS.SET_AUTO_UPDATES)).toEqual([]);
    });
  });

  describe("Tray", () => {
    it("keeps Tokio in the tray unless it's turned off", async () => {
      const { user } = await setup();
      const tray = screen.getByRole("checkbox", {
        name: "Keep Tokio running in the tray when you close it",
      });
      expect(tray).toBeChecked();

      await user.click(tray);
      expect(tray).not.toBeChecked();

      await user.click(tray);
      expect(tray).toBeChecked();

      expect(sent(APP_EVENTS.SET_TRAY)).toEqual([
        { enabled: false },
        { enabled: true },
      ]);
    });
  });

  describe("Logs", () => {
    const debugBox = () =>
      screen.getByRole("checkbox", { name: "Detailed logs" });

    it("shows the saved setting", async () => {
      await setup(
        settingsReply((s) => {
          s.settings.logs.debug = true;
        }),
      );

      expect(debugBox()).toBeChecked();
    });

    it("asks before turning on detailed logs, and Cancel leaves them off", async () => {
      const { user } = await setup();
      expect(debugBox()).not.toBeChecked();

      await user.click(debugBox());
      expect(dialog().getByText("Turn on detailed logs?")).toBeInTheDocument();
      expect(debugBox()).not.toBeChecked();

      await user.click(dialog().getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(debugBox()).not.toBeChecked();
      expect(sentEvents()).not.toContain(APP_EVENTS.SET_LOGS);
    });

    it("turns on detailed logs once confirmed", async () => {
      const { user } = await setup();

      await user.click(debugBox());
      await user.click(dialog().getByRole("button", { name: "Turn on" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(debugBox()).toBeChecked();
      expect(sent(APP_EVENTS.SET_LOGS)).toEqual([{ enabled: true }]);
    });

    it("turns detailed logs off right away", async () => {
      const { user } = await setup(
        settingsReply((s) => {
          s.settings.logs.debug = true;
        }),
      );

      await user.click(debugBox());

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(debugBox()).not.toBeChecked();
      expect(sent(APP_EVENTS.SET_LOGS)).toEqual([{ enabled: false }]);
    });

    it("exports the logs", async () => {
      const { user } = await setup();

      await user.click(screen.getByRole("button", { name: "Export logs" }));

      expect(sent(APP_EVENTS.EXPORT_LOGS)).toEqual([undefined]);
    });
  });

  describe("Language", () => {
    it("follows the system until a language is picked, each in its own name", async () => {
      const { user, container } = await setup();
      const language = section("Language");
      expect(language.getByText("System language")).toBeInTheDocument();

      await user.click(language.getByText("System language"));
      expect(inList(container, "English")).not.toBeNull();
      await user.click(inList(container, "Español")!);
      expect(language.getByText("Español")).toBeInTheDocument();

      await user.click(language.getByText("Español"));
      await user.click(inList(container, "System language")!);

      expect(sent(APP_EVENTS.SET_LANGUAGE)).toEqual([
        { language: "es-419" },
        { language: "system" },
      ]);
    });

    it("shows a saved language Tokio no longer has as the system's", async () => {
      await setup(
        settingsReply((s) => {
          s.settings.language = "fr";
        }),
      );

      expect(
        section("Language").getByText("System language"),
      ).toBeInTheDocument();
    });
  });

  describe("Profiles", () => {
    it("switches to the profile picked", async () => {
      const { user, container } = await setup();

      await user.click(section("Profiles").getByText("Horror"));
      await user.click(inList(container, "Default")!);

      expect(sent(APP_EVENTS.SET_PROFILE)).toEqual([{ file: "default.json" }]);
    });

    it("can't switch while connected", async () => {
      const { user, container } = await setup();
      expect(
        screen.queryByText("(disconnect to switch)"),
      ).not.toBeInTheDocument();

      await connected(true);
      expect(screen.getByText("(disconnect to switch)")).toBeInTheDocument();

      await user.click(section("Profiles").getByText("Horror"));
      expect(inList(container, "Default")).toBeNull();

      await connected(false);
      expect(
        screen.queryByText("(disconnect to switch)"),
      ).not.toBeInTheDocument();
    });

    it("creates a profile with the name typed", async () => {
      const { user } = await setup();

      await user.click(
        section("Profiles").getByRole("button", { name: "New" }),
      );
      expect(dialog().getByText("Create a profile")).toBeInTheDocument();

      await user.type(
        dialog().getByPlaceholderText("e.g. Chill Stream"),
        "Chill",
      );
      await user.click(
        dialog().getByRole("button", { name: "Create profile" }),
      );

      expect(sent(APP_EVENTS.CREATE_PROFILE)).toEqual([{ name: "Chill" }]);
      expect(dialog().getByText("Create a profile")).toBeInTheDocument();

      await send(APP_EVENTS_RESPONSE.CREATE_PROFILE, { success: true });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps the new profile's name to fix when main refuses it", async () => {
      const { user } = await setup();
      await user.click(
        section("Profiles").getByRole("button", { name: "New" }),
      );
      const field = dialog().getByPlaceholderText("e.g. Chill Stream");
      await user.type(field, "Horror");
      await user.click(
        dialog().getByRole("button", { name: "Create profile" }),
      );
      // Once until main answers
      await user.click(
        dialog().getByRole("button", { name: "Create profile" }),
      );
      expect(sent(APP_EVENTS.CREATE_PROFILE)).toEqual([{ name: "Horror" }]);

      await send(APP_EVENTS_RESPONSE.CREATE_PROFILE, failure());

      expect(dialog().getByText("Create a profile")).toBeInTheDocument();
      expect(field).toHaveValue("Horror");
      await user.type(field, " 2");
      await user.click(
        dialog().getByRole("button", { name: "Create profile" }),
      );
      expect(sent(APP_EVENTS.CREATE_PROFILE)).toEqual([
        { name: "Horror" },
        { name: "Horror 2" },
      ]);
    });

    it("doesn't create a profile without a name", async () => {
      const { user } = await setup();
      await user.click(
        section("Profiles").getByRole("button", { name: "New" }),
      );

      await user.type(dialog().getByPlaceholderText("e.g. Chill Stream"), "  ");
      await user.click(
        dialog().getByRole("button", { name: "Create profile" }),
      );

      expect(sent(APP_EVENTS.CREATE_PROFILE)).toEqual([]);
      expect(dialog().getByText("Create a profile")).toBeInTheDocument();

      await user.click(dialog().getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("clones the active profile unless another is picked", async () => {
      const { user } = await setup();

      await user.click(
        section("Profiles").getByRole("button", { name: "Clone" }),
      );
      expect(dialog().getByText("Clone a profile")).toBeInTheDocument();
      expect(dialog().getByText("Horror")).toBeInTheDocument();

      await user.type(
        dialog().getByPlaceholderText("e.g. Horror Stream Layout"),
        "Horror 2",
      );
      await user.click(dialog().getByRole("button", { name: "Clone profile" }));

      expect(sent(APP_EVENTS.CLONE_PROFILE)).toEqual([
        { name: "Horror 2", ref: "horror.json" },
      ]);
      expect(dialog().getByText("Clone a profile")).toBeInTheDocument();

      await send(APP_EVENTS_RESPONSE.CLONE_PROFILE, { success: true });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("stays open when main refuses the clone", async () => {
      const { user } = await setup();
      await user.click(
        section("Profiles").getByRole("button", { name: "Clone" }),
      );
      const field = dialog().getByPlaceholderText("e.g. Horror Stream Layout");
      await user.type(field, "Default");
      await user.click(dialog().getByRole("button", { name: "Clone profile" }));

      await send(APP_EVENTS_RESPONSE.CLONE_PROFILE, failure());

      expect(dialog().getByText("Clone a profile")).toBeInTheDocument();
      expect(field).toHaveValue("Default");
    });

    it("clones the profile picked", async () => {
      const { user, container } = await setup();
      await user.click(
        section("Profiles").getByRole("button", { name: "Clone" }),
      );

      await user.click(dialog().getByText("Horror"));
      await user.click(inList(container, "Default")!);
      await user.type(
        dialog().getByPlaceholderText("e.g. Horror Stream Layout"),
        "Copy",
      );
      await user.click(dialog().getByRole("button", { name: "Clone profile" }));

      expect(sent(APP_EVENTS.CLONE_PROFILE)).toEqual([
        { name: "Copy", ref: "default.json" },
      ]);
    });

    it("doesn't clone without a name", async () => {
      const { user } = await setup();
      await user.click(
        section("Profiles").getByRole("button", { name: "Clone" }),
      );

      await user.click(dialog().getByRole("button", { name: "Clone profile" }));

      expect(sent(APP_EVENTS.CLONE_PROFILE)).toEqual([]);
      expect(dialog().getByText("Clone a profile")).toBeInTheDocument();
    });

    it("imports a profile and exports the active one", async () => {
      const { user } = await setup();
      const profilesSection = section("Profiles");

      await user.click(profilesSection.getByRole("button", { name: "Import" }));
      await user.click(profilesSection.getByRole("button", { name: "Export" }));

      expect(sent(APP_EVENTS.IMPORT_ENTITY)).toEqual([{ type: "profile" }]);
      expect(sent(APP_EVENTS.EXPORT_ENTITY)).toEqual([
        { type: "profile", file: "horror.json" },
      ]);
    });

    const rename = async () => {
      const app = await setup();
      await app.user.click(
        section("Profiles").getByRole("button", { name: "Rename" }),
      );
      const field = within(
        dialog().getByRole("group", { name: "Profile name" }),
      ).getByRole("textbox");
      return { ...app, field };
    };
    const renameButton = () => dialog().getByRole("button", { name: "Rename" });

    it("renames the open profile by its file, once until main answers", async () => {
      const { user, field } = await rename();
      expect(dialog().getByText("Rename the profile")).toBeInTheDocument();
      expect(field).toHaveValue("Horror");

      await user.clear(field);
      await user.type(field, "Scary");
      await user.click(renameButton());
      await user.click(renameButton());

      expect(sent(APP_EVENTS.RENAME_PROFILE)).toEqual([
        { file: "horror.json", name: "Scary" },
      ]);

      // Another profile's answer isn't this one's
      await send(APP_EVENTS_RESPONSE.RENAME_PROFILE, {
        success: true,
        file: "default.json",
      });
      expect(dialog().getByText("Rename the profile")).toBeInTheDocument();

      await send(APP_EVENTS_RESPONSE.RENAME_PROFILE, {
        success: true,
        file: "horror.json",
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps a refused name to fix", async () => {
      const { user, field } = await rename();
      await user.clear(field);
      await user.type(field, "Default");
      await user.click(renameButton());

      await send(APP_EVENTS_RESPONSE.RENAME_PROFILE, {
        ...failure(),
        file: "horror.json",
      });

      expect(field).toHaveValue("Default");
      await user.type(field, " 2");
      await user.click(renameButton());
      expect(sent(APP_EVENTS.RENAME_PROFILE)).toEqual([
        { file: "horror.json", name: "Default" },
        { file: "horror.json", name: "Default 2" },
      ]);
    });

    it("sends nothing for an empty or unchanged name", async () => {
      const { user, field } = await rename();
      await user.clear(field);
      await user.type(field, "  ");
      await user.click(renameButton());
      expect(dialog().getByText("Rename the profile")).toBeInTheDocument();

      await user.clear(field);
      await user.type(field, " Horror ");
      await user.click(renameButton());

      expect(sent(APP_EVENTS.RENAME_PROFILE)).toEqual([]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("Shortcuts", () => {
    const row = (name: string) => within(screen.getByRole("group", { name }));

    const withShortcuts = settingsReply((s) => {
      s.settings.shortcuts.pause = "Ctrl+Shift+P";
    });

    it("saves a recorded shortcut with the others, right away", async () => {
      const { user } = await setup(withShortcuts);
      expect(
        row("Pause everything").getByTitle("Change shortcut"),
      ).toHaveTextContent("Ctrl + Shift + P");

      await user.click(row("Skip song").getByTitle("Change shortcut"));
      await user.keyboard("{Control>}{Shift>}n{/Shift}{/Control}");

      expect(sent(APP_EVENTS.SET_SHORTCUTS)).toEqual([
        {
          shortcuts: {
            skipSong: "Ctrl+Shift+N",
            stopTts: "",
            replayAlert: "",
            pause: "Ctrl+Shift+P",
          },
        },
      ]);
      expect(row("Skip song").getByTitle("Change shortcut")).toHaveTextContent(
        "Ctrl + Shift + N",
      );
    });

    it("moves a shortcut that another row had", async () => {
      const { user } = await setup(withShortcuts);

      await user.click(row("Stop TTS").getByTitle("Change shortcut"));
      await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");

      expect(sent(APP_EVENTS.SET_SHORTCUTS).at(-1)!.shortcuts).toMatchObject({
        stopTts: "Ctrl+Shift+P",
        pause: "",
      });
    });

    it("says which shortcuts another app holds, until the row changes", async () => {
      const { user } = await setup(withShortcuts);

      await send(APP_EVENTS_RESPONSE.SET_SHORTCUTS, {
        success: true,
        taken: ["pause"],
      });
      expect(
        row("Pause everything").getByText("In use by another app"),
      ).toBeVisible();
      expect(screen.getAllByText("In use by another app")).toHaveLength(1);

      await user.click(row("Pause everything").getByTitle("Remove shortcut"));

      expect(
        row("Pause everything").queryByText("In use by another app"),
      ).not.toBeInTheDocument();
      expect(sent(APP_EVENTS.SET_SHORTCUTS).at(-1)!.shortcuts.pause).toBe("");
    });
  });
  describe("Remote control", () => {
    const remote = () => section("Remote control");
    const key = "s3cr3t-key";
    const on = settingsReply((s) => {
      s.settings.server.enabled = true;
      s.settings.remote = { enabled: true, key };
    });
    const addresses = (list: string[]) =>
      send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, { addresses: list });

    it("turns it on and off", async () => {
      const { user } = await setup();
      const box = remote().getByRole("checkbox", {
        name: "Enable remote control",
      });

      await user.click(box);
      expect(box).toBeChecked();
      await user.click(box);

      expect(sent(APP_EVENTS.SET_REMOTE)).toEqual([
        { enabled: true },
        { enabled: false },
      ]);
    });

    it("says the phone needs the overlay server while it is off", async () => {
      await setup();
      const hint = /The overlay server is off/;
      expect(remote().getByText(hint)).toBeVisible();

      await send(APP_EVENTS_RESPONSE.GET_SETTINGS, on);
      expect(remote().queryByText(hint)).not.toBeInTheDocument();
    });

    it("shows the QR code, link and key only after Show", async () => {
      const { user } = await setup(on);
      await addresses(["192.168.1.20"]);
      const link = "http://192.168.1.20:37891/remote/#key=s3cr3t-key";

      expect(remote().queryByRole("img")).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(key);

      const toggle = remote().getByRole("button", {
        name: "Show QR code and key",
      });
      await user.click(toggle);
      expect(
        remote().getByRole("img", {
          name: "QR code of the remote control link",
        }),
      ).toBeInTheDocument();
      expect(remote().getByTitle("Copy link")).toHaveTextContent(link);
      expect(remote().getByTitle("Copy key")).toHaveTextContent(key);

      // The same button, so the focus stays on it
      expect(toggle).toHaveTextContent("Hide");
      expect(toggle).toHaveFocus();
      await user.click(toggle);
      expect(remote().queryByRole("img")).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(key);
      expect(toggle).toHaveTextContent("Show QR code and key");
      expect(toggle).toHaveFocus();
    });

    it("shows the MCP address and each assistant's setup after Show", async () => {
      const { user, container } = await setup(on);
      await addresses(["192.168.1.20"]);
      expect(remote().queryByTitle("Copy MCP address")).not.toBeInTheDocument();

      await user.click(
        remote().getByRole("button", { name: "Show QR code and key" }),
      );

      expect(remote().getByTitle("Copy MCP address")).toHaveTextContent(
        "http://127.0.0.1:37891/mcp",
      );
      expect(
        remote().getByTitle("Copy the Claude Code setup"),
      ).toHaveTextContent(
        `claude mcp add --transport http tokio http://127.0.0.1:37891/mcp --header "Authorization: Bearer ${key}"`,
      );
      expect(remote().getByText("Run it in a terminal.")).toBeVisible();

      await user.click(remote().getByText("Claude Code"));
      await user.click(inList(container, "Cursor")!);

      expect(remote().getByTitle("Copy the Cursor setup")).toHaveTextContent(
        `"Authorization": "Bearer ${key}"`,
      );
      expect(remote().getByText("Add it to ~/.cursor/mcp.json.")).toBeVisible();
      expect(
        remote().getByText(
          "AI assistants can connect from this computer only.",
        ),
      ).toBeVisible();
    });

    it("picks the address the link uses", async () => {
      const { user, container } = await setup(on);
      await addresses(["192.168.1.20", "10.0.0.5"]);
      await user.click(
        remote().getByRole("button", { name: "Show QR code and key" }),
      );
      expect(remote().getByTitle("Copy link")).toHaveTextContent(
        "http://192.168.1.20:37891/",
      );

      await user.click(remote().getByText("192.168.1.20"));
      await user.click(inList(container, "10.0.0.5")!);

      expect(remote().getByTitle("Copy link")).toHaveTextContent(
        "http://10.0.0.5:37891/remote/#key=s3cr3t-key",
      );
    });

    it("says when there is no network, and still shows the key", async () => {
      const { user } = await setup(on);
      await addresses([]);
      await user.click(
        remote().getByRole("button", { name: "Show QR code and key" }),
      );

      expect(remote().getByText(/No network address found/)).toBeVisible();
      expect(remote().queryByRole("img")).not.toBeInTheDocument();
      expect(remote().getByTitle("Copy key")).toHaveTextContent(key);
    });

    const newKey = () =>
      remote().queryByTitle("New key (old links stop working)");

    it("makes a new key from the title row, once confirmed", async () => {
      const { user } = await setup(on);

      await user.click(newKey()!);
      expect(
        dialog().getByText(
          "Your phone, Stream Deck and AI assistants will need the new one.",
        ),
      ).toBeVisible();
      await user.click(dialog().getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(sent(APP_EVENTS.NEW_REMOTE_KEY)).toEqual([]);

      await user.click(newKey()!);
      await user.click(dialog().getByRole("button", { name: "New key" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(sent(APP_EVENTS.NEW_REMOTE_KEY)).toEqual([undefined]);
    });

    it("offers a new key only while remote control is on", async () => {
      await setup();
      expect(newKey()).not.toBeInTheDocument();

      await send(APP_EVENTS_RESPONSE.GET_SETTINGS, on);
      expect(newKey()).toBeVisible();
    });
  });
});
