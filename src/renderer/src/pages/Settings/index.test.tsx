import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { useUnsavedChanges } from "@/hooks";
import { failure, settingsReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { inList, section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { Settings } from ".";

const profiles = settingsReply((s) => {
  s.profiles = [
    { file: "default.json", name: "Default" },
    { file: "horror.json", name: "Horror" },
  ];
  s.settings.activeProfile = { file: "horror.json", name: "Horror" };
});

const dialog = () => within(screen.getByRole("dialog"));

const serverBox = () => screen.getByRole("checkbox", { name: "Enable Server" });
const connected = (success: boolean) =>
  send(APP_EVENTS_RESPONSE.CONNECTED, {
    success,
    stats: { views: 0, viewers: 0, likes: 0 },
  });

// A page with unsaved settings, like TTS with a change
function DirtyEditor({ discard }: { discard: () => void }) {
  const { register } = useUnsavedChanges();
  useEffect(
    () =>
      register({
        label: "TTS",
        isDirty: () => true,
        save: async () => true,
        discard,
      }),
    [register, discard],
  );
  return null;
}

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

  describe("Overlay Server", () => {
    it("asks before enabling the server, and Cancel leaves it off", async () => {
      const { user } = await setup();

      await user.click(serverBox());
      expect(dialog().getByText("Enable Overlay Server?")).toBeInTheDocument();
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
      await user.click(dialog().getByRole("button", { name: "Enable Server" }));

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
      await user.click(dialog().getByRole("button", { name: "Enable Server" }));

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
  });

  describe("Live Profiles", () => {
    it("switches to the profile picked", async () => {
      const { user, container } = await setup();

      await user.click(section("Live Profiles").getByText("Horror"));
      await user.click(inList(container, "Default")!);

      await waitFor(() =>
        expect(sent(APP_EVENTS.SET_PROFILE)).toEqual([
          { file: "default.json" },
        ]),
      );
    });

    it("switches only after the unsaved changes are handled", async () => {
      const discard = vi.fn();
      const { user, container } = renderWithProviders(
        <>
          <DirtyEditor discard={discard} />
          <Settings />
        </>,
      );
      await send(APP_EVENTS_RESPONSE.GET_SETTINGS, profiles);

      await user.click(section("Live Profiles").getByText("Horror"));
      await user.click(inList(container, "Default")!);
      expect(
        dialog().getByText(/You have unsaved TTS settings/),
      ).toBeInTheDocument();
      expect(sent(APP_EVENTS.SET_PROFILE)).toEqual([]);

      await user.click(dialog().getByRole("button", { name: "Discard" }));

      expect(discard).toHaveBeenCalled();
      await waitFor(() =>
        expect(sent(APP_EVENTS.SET_PROFILE)).toEqual([
          { file: "default.json" },
        ]),
      );
    });

    it("stays on the profile when the unsaved changes prompt is canceled", async () => {
      const { user, container } = renderWithProviders(
        <>
          <DirtyEditor discard={vi.fn()} />
          <Settings />
        </>,
      );
      await send(APP_EVENTS_RESPONSE.GET_SETTINGS, profiles);

      await user.click(section("Live Profiles").getByText("Horror"));
      await user.click(inList(container, "Default")!);
      await user.click(dialog().getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(sent(APP_EVENTS.SET_PROFILE)).toEqual([]);
    });

    it("can't switch while connected", async () => {
      const { user, container } = await setup();
      expect(
        screen.queryByText("(disconnect to switch)"),
      ).not.toBeInTheDocument();

      await connected(true);
      expect(screen.getByText("(disconnect to switch)")).toBeInTheDocument();

      await user.click(section("Live Profiles").getByText("Horror"));
      expect(inList(container, "Default")).toBeNull();

      await connected(false);
      expect(
        screen.queryByText("(disconnect to switch)"),
      ).not.toBeInTheDocument();
    });

    it("creates a profile with the name typed", async () => {
      const { user } = await setup();

      await user.click(
        section("Live Profiles").getByRole("button", { name: "New" }),
      );
      expect(dialog().getByText("Create New Profile")).toBeInTheDocument();

      await user.type(
        dialog().getByPlaceholderText("e.g. Chill Stream"),
        "Chill",
      );
      await user.click(
        dialog().getByRole("button", { name: "Create Profile" }),
      );

      expect(sent(APP_EVENTS.CREATE_PROFILE)).toEqual([{ name: "Chill" }]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("doesn't create a profile without a name", async () => {
      const { user } = await setup();
      await user.click(
        section("Live Profiles").getByRole("button", { name: "New" }),
      );

      await user.type(dialog().getByPlaceholderText("e.g. Chill Stream"), "  ");
      await user.click(
        dialog().getByRole("button", { name: "Create Profile" }),
      );

      expect(sent(APP_EVENTS.CREATE_PROFILE)).toEqual([]);
      expect(dialog().getByText("Create New Profile")).toBeInTheDocument();

      await user.click(dialog().getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("clones the active profile unless another is picked", async () => {
      const { user } = await setup();

      await user.click(
        section("Live Profiles").getByRole("button", { name: "Clone" }),
      );
      expect(dialog().getByText("Clone Existing Profile")).toBeInTheDocument();
      expect(dialog().getByText("Horror")).toBeInTheDocument();

      await user.type(
        dialog().getByPlaceholderText("e.g. Horror Stream Layout"),
        "Horror 2",
      );
      await user.click(dialog().getByRole("button", { name: "Clone Profile" }));

      expect(sent(APP_EVENTS.CLONE_PROFILE)).toEqual([
        { name: "Horror 2", ref: "horror.json" },
      ]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("clones the profile picked", async () => {
      const { user, container } = await setup();
      await user.click(
        section("Live Profiles").getByRole("button", { name: "Clone" }),
      );

      await user.click(dialog().getByText("Horror"));
      await user.click(inList(container, "Default")!);
      await user.type(
        dialog().getByPlaceholderText("e.g. Horror Stream Layout"),
        "Copy",
      );
      await user.click(dialog().getByRole("button", { name: "Clone Profile" }));

      expect(sent(APP_EVENTS.CLONE_PROFILE)).toEqual([
        { name: "Copy", ref: "default.json" },
      ]);
    });

    it("doesn't clone without a name", async () => {
      const { user } = await setup();
      await user.click(
        section("Live Profiles").getByRole("button", { name: "Clone" }),
      );

      await user.click(dialog().getByRole("button", { name: "Clone Profile" }));

      expect(sent(APP_EVENTS.CLONE_PROFILE)).toEqual([]);
      expect(dialog().getByText("Clone Existing Profile")).toBeInTheDocument();
    });

    it("imports a profile and exports the active one", async () => {
      const { user } = await setup();
      const profilesSection = section("Live Profiles");

      await user.click(profilesSection.getByRole("button", { name: "Import" }));
      await user.click(profilesSection.getByRole("button", { name: "Export" }));

      expect(sent(APP_EVENTS.IMPORT_ENTITY)).toEqual([{ type: "profile" }]);
      expect(sent(APP_EVENTS.EXPORT_ENTITY)).toEqual([
        { type: "profile", file: "horror.json" },
      ]);
    });
  });
});
