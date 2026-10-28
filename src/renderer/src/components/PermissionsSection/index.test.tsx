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
    expect(box("Followers only")).not.toBeChecked();
    expect(box("Super Fans only")).not.toBeChecked();
    expect(box("Moderators only")).toBeChecked();
  });

  it.each([
    ["Allow everyone", "all"],
    ["Followers only", "followers"],
    ["Super Fans only", "superfans"],
    ["Moderators only", "moderators"],
  ] as const)("toggles %s", async (label, key) => {
    const user = setup();
    const before = current()[key];

    await user.click(box(label));
    expect(current()[key]).toBe(!before);
    expect(box(label).matches(":checked")).toBe(!before);

    await user.click(box(label));
    expect(current()[key]).toBe(before);
  });

  it("edits the fan level once Minimum fan level is on", async () => {
    const user = setup();
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
    const user = setup();
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
