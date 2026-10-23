import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmoteMultiSelect, EmoteOption } from ".";

const emote = (n: number): EmoteOption => ({
  value: `e${n}`,
  label: `Emote ${n}`,
  img: `e${n}.png`,
});
const EMOTES = [1, 2, 3, 4, 5].map(emote);
const NAMES = EMOTES.map((e) => e.label);

function setup(value: string[] = [], emotes: EmoteOption[] = EMOTES) {
  const onChange = vi.fn();
  const view = render(
    <EmoteMultiSelect
      placeholder="Any emote"
      emotes={emotes}
      value={value}
      onChange={onChange}
    />,
  );
  // The field is the only thing rendered in place, the picker is portaled
  const field = within(view.container).getByRole("button");
  return { ...view, onChange, field, user: userEvent.setup() };
}

const dialog = () => screen.queryByRole("dialog");
const picker = () => within(screen.getByRole("dialog"));
const button = (name: string) => picker().getByRole("button", { name });

// The picker's rows are titled by their emote's name.
const row = (name: string) => picker().getByTitle(name);
const checkbox = (name: string) => within(row(name)).getByRole("checkbox");

// Emote names in the picker's list, in order
const listed = () =>
  picker()
    .queryAllByTitle(/./)
    .map((el) => el.title)
    .filter((title) => NAMES.includes(title));

const images = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("img"), (img) => img.getAttribute("src"));

const status = () => picker().getByText(/selected$/);

async function openPicker(value?: string[]) {
  const view = setup(value);
  await view.user.click(view.field);
  return view;
}

describe("EmoteMultiSelect", () => {
  it("shows the placeholder until emotes are picked", () => {
    const { field } = setup();

    expect(field).toHaveTextContent("Any emote");
    expect(field).not.toHaveAttribute("title");
    expect(images(field)).toEqual([]);
  });

  it("shows one emote with its picture", () => {
    const { field } = setup(["e2"]);

    expect(field).toHaveTextContent("Emote 2");
    expect(field).toHaveAttribute("title", "Emote 2");
    expect(images(field)).toEqual(["e2.png"]);
  });

  it("counts several emotes, shows a few and names them all in its title", () => {
    const { field } = setup(["e4", "e1", "e5", "e2"]);

    expect(field).toHaveTextContent("4 emotes");
    expect(field).toHaveAttribute(
      "title",
      "Emote 1, Emote 2, Emote 4, Emote 5",
    );
    expect(images(field)).toEqual(["e1.png", "e2.png", "e4.png"]);
  });

  it("counts the emotes the list doesn't have", () => {
    const { field, unmount } = setup(["e1", "gone"]);
    expect(field).toHaveTextContent("2 emotes");
    expect(field).toHaveAttribute("title", "Emote 1");
    unmount();

    const missing = setup(["gone"]).field;
    expect(missing).toHaveTextContent("1 emote");
    expect(missing).not.toHaveAttribute("title");
  });

  it("opens the picker over everything else", async () => {
    const { user, field, container } = setup();
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);

    expect(
      picker().getByRole("heading", { name: "Select emotes" }),
    ).toBeInTheDocument();
    expect(container).not.toContainElement(dialog());
  });

  it("lists the emotes picked when it opened first, and keeps them in place", async () => {
    const { user } = await openPicker(["e4", "e2"]);
    const order = ["Emote 2", "Emote 4", "Emote 1", "Emote 3", "Emote 5"];
    expect(listed()).toEqual(order);
    expect(status()).toHaveTextContent("5 emotes · 2 selected");

    // Rows don't move under the pointer.
    await user.click(row("Emote 5"));
    await user.click(row("Emote 2"));

    expect(checkbox("Emote 5")).toBeChecked();
    expect(checkbox("Emote 2")).not.toBeChecked();
    expect(listed()).toEqual(order);
  });

  it("checks emotes and keeps them on Done", async () => {
    const { user, onChange } = await openPicker(["e3"]);
    expect(checkbox("Emote 3")).toBeChecked();
    expect(checkbox("Emote 1")).not.toBeChecked();

    await user.click(row("Emote 1"));
    await user.click(checkbox("Emote 5"));
    await user.click(row("Emote 3"));

    expect(status()).toHaveTextContent("5 emotes · 2 selected");
    expect(onChange).not.toHaveBeenCalled();

    await user.click(button("Done"));

    expect(onChange).toHaveBeenCalledWith(["e1", "e5"]);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("drops the changes on Cancel or Escape, and saves nothing when Done changes nothing", async () => {
    const { user, field, onChange } = await openPicker(["e3"]);

    await user.click(row("Emote 1"));
    await user.click(button("Cancel"));
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);
    expect(checkbox("Emote 1")).not.toBeChecked();
    expect(checkbox("Emote 3")).toBeChecked();
    await user.click(row("Emote 1"));
    await user.keyboard("{Escape}");
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);
    await user.click(row("Emote 1"));
    await user.click(row("Emote 1"));
    await user.click(button("Done"));
    expect(dialog()).not.toBeInTheDocument();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects every emote, after the ones picked", async () => {
    const { user, onChange } = await openPicker(["e3"]);

    await user.click(button("Select all"));

    expect(checkbox("Emote 1")).toBeChecked();
    expect(checkbox("Emote 5")).toBeChecked();
    expect(status()).toHaveTextContent("5 emotes · 5 selected");
    expect(button("Select all")).toBeDisabled();

    await user.click(button("Done"));
    expect(onChange).toHaveBeenCalledWith(["e3", "e1", "e2", "e4", "e5"]);
  });

  it("clears the selection, emotes the list doesn't have too", async () => {
    const { user, onChange } = await openPicker(["e1", "e4", "gone"]);
    expect(status()).toHaveTextContent("3 selected");

    await user.click(button("Clear"));

    expect(checkbox("Emote 1")).not.toBeChecked();
    expect(checkbox("Emote 4")).not.toBeChecked();
    expect(status()).toHaveTextContent("0 selected");
    expect(button("Clear")).toBeDisabled();

    await user.click(button("Done"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("says when there are no emotes", async () => {
    const { user, field } = setup([], []);

    await user.click(field);

    expect(picker().getByText("No emotes yet.")).toBeInTheDocument();
    expect(status()).toHaveTextContent("0 emotes · 0 selected");
    expect(button("Select all")).toBeDisabled();
    expect(button("Clear")).toBeDisabled();
  });
});
