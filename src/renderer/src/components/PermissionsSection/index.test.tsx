import { Permissions } from "@/common/schemas";
import { Platform } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { PlatformsContext } from "@/context/platforms";
import { useImmerState } from "@/hooks/useImmerState";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PermissionsSection } from ".";

// Every value the section was rendered with
const states: Permissions[] = [];
const current = () => states.at(-1)!;

// Holds the permissions, like the TTS and Music pages do
function PermissionsForm({
  initial,
  feature = "TTS",
}: {
  initial: Permissions;
  feature?: "TTS" | "Music";
}) {
  const [permissions, update] = useImmerState(initial);
  states.push(permissions);
  return (
    <PermissionsSection
      permissions={permissions}
      update={update}
      feature={feature}
    />
  );
}

function setup(recipe?: (p: Permissions) => void) {
  const initial = structuredClone(defaultProfile.tts.permissions);
  recipe?.(initial);
  render(<PermissionsForm initial={initial} />);
  return userEvent.setup();
}

const box = (name: string) => screen.getByRole("checkbox", { name });
// Hidden from screen readers while Minimum fan level is off
const level = () => screen.getByRole("spinbutton", { hidden: true });
// The control under a field's label
const field = (label: string) =>
  within(screen.getByText(label).parentElement!).getByRole("textbox");

beforeEach(() => {
  states.length = 0;
});

describe("PermissionsSection", () => {
  it("names the feature in its description", () => {
    render(
      <PermissionsForm
        initial={structuredClone(defaultProfile.music.permissions)}
        feature="Music"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Permissions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Who can use Music.")).toBeInTheDocument();
  });

  it("shows the saved roles", () => {
    setup((p) => {
      p.all = false;
      p.moderators = true;
    });

    expect(box("Allow everyone")).not.toBeChecked();
    expect(box("Followers")).not.toBeChecked();
    expect(box("Super Fans")).not.toBeChecked();
    expect(box("Moderators")).toBeChecked();
  });

  it.each([
    ["Allow everyone", "all"],
    ["Followers", "followers"],
    ["Super Fans", "superfans"],
    ["Moderators", "moderators"],
  ] as const)("toggles %s", async (label, key) => {
    // Allow everyone turns the roles off
    const user = setup((p) => {
      if (key !== "all") p.all = false;
    });
    const before = current()[key];

    await user.click(box(label));
    expect(current()[key]).toBe(!before);
    expect(box(label).matches(":checked")).toBe(!before);

    await user.click(box(label));
    expect(current()[key]).toBe(before);
  });

  it("turns the roles off while Allow everyone is on, and says how they combine", async () => {
    const user = setup((p) => {
      p.all = true;
      p.level.enabled = true;
    });
    for (const name of [
      "Followers",
      "Super Fans",
      "Moderators",
      "Minimum fan level",
    ]) {
      expect(box(name)).toBeDisabled();
    }
    expect(level()).toBeDisabled();
    expect(
      screen.getByText(
        "Anyone who is one of these, or has the fan level, can use TTS. With none checked, everyone can.",
      ),
    ).toBeInTheDocument();

    await user.click(box("Allow everyone"));

    expect(box("Followers")).toBeEnabled();
    expect(level()).toBeEnabled();
  });

  it("says the allow list's names are the only ones who can use the feature", async () => {
    setup((p) => {
      p.list.enabled = true;
    });

    expect(
      screen.getByText("When it has names, only they can use TTS."),
    ).toBeInTheDocument();
  });

  it("edits the fan level once Minimum fan level is on", async () => {
    const user = setup((p) => {
      p.all = false;
    });
    expect(level()).toBeDisabled();

    await user.click(box("Minimum fan level"));
    expect(current().level.enabled).toBe(true);
    expect(level()).toBeEnabled();

    await user.clear(level());
    await user.type(level(), "12");
    expect(current().level.value).toBe(12);

    await user.click(box("Minimum fan level"));
    expect(level()).toBeDisabled();
    expect(current().level).toEqual({ enabled: false, value: 12 });
  });

  it("keeps the fan level from the keyboard and screen readers while it's hidden", async () => {
    const user = setup((p) => {
      p.all = false;
    });
    expect(level()).toHaveAttribute("aria-hidden", "true");
    expect(level()).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(box("Minimum fan level"));

    expect(screen.getByRole("spinbutton")).not.toHaveAttribute("aria-hidden");
    expect(level()).not.toHaveAttribute("tabindex");
  });

  it("shows the lists only while the allow and block lists are on", async () => {
    const user = setup();
    expect(screen.queryByText("Allow list")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    await user.click(box("Use allow and block lists"));
    expect(current().list.enabled).toBe(true);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);

    await user.click(box("Use allow and block lists"));
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("edits the allow list and the block list", async () => {
    const user = setup((p) => {
      p.list.enabled = true;
      p.list.black = ["spammer"];
    });
    expect(field("Block list")).toHaveValue("spammer");

    await user.type(field("Allow list"), "alice, bob");
    await user.type(field("Block list"), ", troll");

    expect(current().list.white).toEqual(["alice", "bob"]);
    expect(current().list.black).toEqual(["spammer", "troll"]);
  });
});

describe("PermissionsSection with other platforms", () => {
  const lists = "The lists apply on every platform.";

  function withPlatforms(
    platforms: Platform[],
    recipe?: (p: Permissions) => void,
  ) {
    const initial = structuredClone(defaultProfile.tts.permissions);
    recipe?.(initial);
    const view = render(
      <PlatformsContext value={platforms}>
        <PermissionsForm initial={initial} />
      </PlatformsContext>,
    );
    return { user: userEvent.setup(), view };
  }

  const tab = (name: string) => screen.getByRole("tab", { name });

  it("has a tab for each of the profile's platforms, TikTok's open", () => {
    withPlatforms(["kick", "tiktok", "youtube"]);

    const tabs = screen.getByRole("tablist", { name: "Platform" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["TikTok", "YouTube", "Kick"]);
    expect(tab("TikTok")).toHaveAttribute("aria-selected", "true");
    expect(box("Followers")).toBeInTheDocument();
    expect(box("Minimum fan level")).toBeInTheDocument();
    expect(screen.getByText(lists)).toBeInTheDocument();
  });

  it("has no tabs with one platform", () => {
    setup();

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText(lists)).not.toBeInTheDocument();
  });

  it("shows Twitch's rules alone without tabs", () => {
    withPlatforms(["twitch"]);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(box("Subscribers")).toBeInTheDocument();
    expect(screen.queryByText(lists)).not.toBeInTheDocument();
  });

  it.each([
    ["Twitch", ["Allow everyone", "Subscribers", "Moderators", "VIPs"]],
    ["YouTube", ["Allow everyone", "Members", "Moderators"]],
    ["Kick", ["Allow everyone", "Subscribers", "Moderators", "VIPs"]],
  ])("offers on %s's tab what its chat says", async (name, labels) => {
    const { user } = withPlatforms(["tiktok", "twitch", "youtube", "kick"]);

    await user.click(tab(name));

    expect(
      screen.getAllByRole("checkbox").map((c) => c.parentElement?.textContent),
    ).toEqual([...labels, "Use allow and block lists"]);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("allows everyone on a platform without its own rules", async () => {
    const { user } = withPlatforms(["tiktok", "twitch"], (p) => {
      p.all = false;
      p.followers = true;
    });

    await user.click(tab("Twitch"));

    expect(box("Allow everyone")).toBeChecked();
    expect(box("Subscribers")).not.toBeChecked();
  });

  it("saves a platform's rules apart from TikTok's", async () => {
    const { user } = withPlatforms(["tiktok", "twitch"]);

    await user.click(tab("Twitch"));
    await user.click(box("Allow everyone"));
    await user.click(box("Subscribers"));

    expect(current().platforms).toEqual({
      twitch: { all: false, superfans: true, moderators: false, vips: false },
    });
    expect(current().all).toBe(true);
    expect(current().superfans).toBe(false);

    await user.click(tab("TikTok"));
    expect(box("Allow everyone")).toBeChecked();
    expect(box("Super Fans")).not.toBeChecked();
  });

  it("says on another platform's tab how its roles combine", async () => {
    const { user } = withPlatforms(["tiktok", "twitch"]);

    await user.click(tab("Twitch"));

    expect(box("VIPs")).toBeDisabled();
    expect(
      screen.getByText(
        "Anyone who is one of these can use TTS. With none checked, everyone can.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a platform's saved rules", async () => {
    const { user } = withPlatforms(["tiktok", "kick"], (p) => {
      p.platforms.kick = {
        all: false,
        superfans: false,
        moderators: true,
        vips: true,
      };
    });

    await user.click(tab("Kick"));

    expect(box("Allow everyone")).not.toBeChecked();
    expect(box("Subscribers")).not.toBeChecked();
    expect(box("Moderators")).toBeChecked();
    expect(box("VIPs")).toBeChecked();
  });

  it("keeps the shared lists under every tab", async () => {
    const { user } = withPlatforms(["tiktok", "youtube"]);

    await user.click(tab("YouTube"));
    await user.click(box("Use allow and block lists"));
    await user.type(field("Block list"), "troll");

    expect(current().list).toEqual({
      enabled: true,
      white: [],
      black: ["troll"],
    });
    expect(current().platforms).toEqual({});
  });

  it("goes back to the first tab when the open one's platform leaves", async () => {
    const { user, view } = withPlatforms(["tiktok", "twitch"]);
    await user.click(tab("Twitch"));

    view.rerender(
      <PlatformsContext value={["tiktok"]}>
        <PermissionsForm initial={current()} />
      </PlatformsContext>,
    );

    expect(box("Followers")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "VIPs" })).toBeNull();
  });
});
