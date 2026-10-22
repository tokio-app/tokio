import { Permissions } from "@/common/schemas";
import { defaultProfile } from "@/common/util";
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
// Hidden from screen readers while Minimum Fan Level is off
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

    expect(box("Allow Everyone")).not.toBeChecked();
    expect(box("Followers Only")).not.toBeChecked();
    expect(box("Superfans Only")).not.toBeChecked();
    expect(box("Moderators Only")).toBeChecked();
  });

  it.each([
    ["Allow Everyone", "all"],
    ["Followers Only", "followers"],
    ["Superfans Only", "superfans"],
    ["Moderators Only", "moderators"],
  ] as const)("toggles %s", async (label, key) => {
    const user = setup();
    const before = current()[key];

    await user.click(box(label));
    expect(current()[key]).toBe(!before);
    expect(box(label).matches(":checked")).toBe(!before);

    await user.click(box(label));
    expect(current()[key]).toBe(before);
  });

  it("edits the fan level once Minimum Fan Level is on", async () => {
    const user = setup();
    expect(level()).toBeDisabled();

    await user.click(box("Minimum Fan Level"));
    expect(current().level.enabled).toBe(true);
    expect(level()).toBeEnabled();

    await user.clear(level());
    await user.type(level(), "12");
    expect(current().level.value).toBe(12);

    await user.click(box("Minimum Fan Level"));
    expect(level()).toBeDisabled();
    expect(current().level).toEqual({ enabled: false, value: 12 });
  });

  it("keeps the fan level from the keyboard and screen readers while it's hidden", async () => {
    const user = setup();
    expect(level()).toHaveAttribute("aria-hidden", "true");
    expect(level()).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(box("Minimum Fan Level"));

    expect(screen.getByRole("spinbutton")).not.toHaveAttribute("aria-hidden");
    expect(level()).not.toHaveAttribute("tabindex");
  });

  it("shows the lists only while the whitelist and blacklist are on", async () => {
    const user = setup();
    expect(screen.queryByText("Whitelist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    await user.click(box("Enable Whitelist / Blacklist"));
    expect(current().list.enabled).toBe(true);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);

    await user.click(box("Enable Whitelist / Blacklist"));
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("edits the whitelist and the blacklist", async () => {
    const user = setup((p) => {
      p.list.enabled = true;
      p.list.black = ["spammer"];
    });
    expect(field("Blacklist")).toHaveValue("spammer");

    await user.type(field("Whitelist"), "alice, bob");
    await user.type(field("Blacklist"), ", troll");

    expect(current().list.white).toEqual(["alice", "bob"]);
    expect(current().list.black).toEqual(["spammer", "troll"]);
  });
});
