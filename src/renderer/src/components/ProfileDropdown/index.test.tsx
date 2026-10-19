import { EntityMetadata } from "@/common/schemas";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileDropdown } from ".";

const DEFAULT: EntityMetadata = { file: "default.json", name: "Default" };
const HORROR: EntityMetadata = { file: "horror.json", name: "Horror" };
const CHILL: EntityMetadata = { file: "chill.json", name: "Chill" };

function setup({ disabled = false } = {}) {
  const user = userEvent.setup();
  const onProfileSelected = vi.fn<(file: string) => void>();
  render(
    <ProfileDropdown
      profiles={[DEFAULT, HORROR, CHILL]}
      active={DEFAULT}
      disabled={disabled}
      onProfileSelected={onProfileSelected}
    />,
  );
  return { user, onProfileSelected };
}

// The button showing the active profile, the menu's are the profiles
const toggle = () =>
  screen
    .getAllByRole("button")
    .find((button) => button.hasAttribute("aria-expanded"))!;
const listed = () =>
  screen
    .queryAllByRole("button")
    .filter((button) => !button.hasAttribute("aria-expanded"))
    .map((button) => button.textContent);

describe("ProfileDropdown", () => {
  it("shows the active profile, closed", () => {
    setup();

    expect(toggle()).toHaveAccessibleName("Default");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(listed()).toEqual([]);
  });

  it("opens a menu with every profile, the active one marked", async () => {
    const { user } = setup();

    await user.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(listed()).toEqual(["Default", "Horror", "Chill"]);
    expect(
      screen.getByRole("button", { name: "Default", current: true }),
    ).toBeInTheDocument();
  });

  it("switches to the profile picked and closes", async () => {
    const { user, onProfileSelected } = setup();

    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Horror" }));

    expect(onProfileSelected).toHaveBeenCalledExactlyOnceWith("horror.json");
    expect(listed()).toEqual([]);
  });

  it("only closes when the active profile is picked", async () => {
    const { user, onProfileSelected } = setup();

    await user.click(toggle());
    await user.click(screen.getByRole("button", { current: true }));

    expect(onProfileSelected).not.toHaveBeenCalled();
    expect(listed()).toEqual([]);
  });

  it("works from the keyboard, and Escape closes it", async () => {
    const { user, onProfileSelected } = setup();

    await user.tab();
    await user.keyboard("{Enter}");
    expect(listed()).toHaveLength(3);

    await user.keyboard("{Escape}");
    expect(listed()).toEqual([]);
    expect(toggle()).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onProfileSelected).toHaveBeenCalledExactlyOnceWith("horror.json");
    expect(toggle()).toHaveFocus();
  });

  it("closes when the toggle is clicked again", async () => {
    const { user } = setup();

    await user.click(toggle());
    await user.click(toggle());

    expect(listed()).toEqual([]);
  });

  it("can't be opened while disabled", async () => {
    const { user } = setup({ disabled: true });

    await user.click(toggle());

    expect(toggle()).toBeDisabled();
    expect(listed()).toEqual([]);
  });

  it("closes on a click outside", async () => {
    const { user, onProfileSelected } = setup();
    await user.click(toggle());

    await user.click(document.body);

    expect(listed()).toEqual([]);
    expect(onProfileSelected).not.toHaveBeenCalled();
  });
});
