import { CustomGift } from "@/common/types";
import { gift } from "@test/fixtures";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GiftMultiSelect, GiftSelect } from ".";

// The fixture's gifts cost their id in coins
const ROSE = gift(1, "Rose");
const HEART = { ...gift(8, "Heart Me"), coins: 1 };
const DOUGHNUT = gift(30, "Doughnut");
const GALAXY = gift(1000, "Galaxy");
const LION = gift(29999, "Lion");
const GIFTS = [LION, GALAXY, DOUGHNUT, HEART, ROSE];
const NAMES = GIFTS.map((g) => g.label);

function setup(value: number[] = [], gifts: CustomGift[] = GIFTS) {
  const onChange = vi.fn();
  const view = render(
    <GiftMultiSelect
      placeholder="Any gift"
      gifts={gifts}
      value={value}
      onChange={onChange}
    />,
  );
  // The field is the only thing rendered in place, the picker is portaled
  const field = within(view.container).getByRole("button");
  return { ...view, onChange, field, user: userEvent.setup() };
}

function setupSingle(value: number | undefined) {
  const onChange = vi.fn();
  const view = render(
    <GiftSelect gifts={GIFTS} value={value} onChange={onChange} />,
  );
  const field = within(view.container).getByRole("button");
  return { ...view, onChange, field, user: userEvent.setup() };
}

const dialog = () => screen.queryByRole("dialog");
const picker = () => within(screen.getByRole("dialog"));

// The picker's rows are titled by their gift's name.
const row = (name: string) => picker().getByTitle(name);
const checkbox = (name: string) => within(row(name)).getByRole("checkbox");

// Gift names in the picker's list, in order
const listed = () =>
  picker()
    .queryAllByTitle(/./)
    .map((el) => el.title)
    .filter((title) => NAMES.includes(title));

// A Select's options are portaled to the body, outside the picker
const option = (text: string) =>
  screen.getAllByText(text).find((el) => !dialog()?.contains(el))!;

const images = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("img"), (img) => img.getAttribute("src"));

const coins = (name = "Coins") => picker().getByRole("spinbutton", { name });

const status = () => picker().getByText(/selected$/);

async function openPicker(value?: number[]) {
  const view = setup(value);
  await view.user.click(view.field);
  return view;
}

describe("GiftMultiSelect", () => {
  it("shows the placeholder until gifts are picked", () => {
    const { field } = setup();

    expect(field).toHaveTextContent("Any gift");
    expect(field).not.toHaveAttribute("title");
  });

  it("shows one gift with its picture and coins", () => {
    const { field } = setup([1000]);

    expect(field).toHaveTextContent("Galaxy1,000 coins");
    expect(field).toHaveAttribute("title", "Galaxy");
    expect(images(field)).toEqual([GALAXY.img]);
  });

  it("counts several gifts, shows a few and names them all in its title", () => {
    const { field } = setup([1, 1000, 29999, 30]);

    expect(field).toHaveTextContent("4 gifts");
    expect(field).toHaveAttribute("title", "Lion, Galaxy, Doughnut, Rose");
    expect(images(field)).toEqual([LION.img, GALAXY.img, DOUGHNUT.img]);
  });

  it("counts the gifts the list doesn't have", () => {
    const { field, unmount } = setup([1, 999]);
    expect(field).toHaveTextContent("2 gifts");
    expect(field).toHaveAttribute("title", "Rose");
    unmount();

    const missing = setup([999]).field;
    expect(missing).toHaveTextContent("1 gift");
    expect(missing).not.toHaveAttribute("title");
  });

  it("opens the picker over everything else", async () => {
    const { user, field, container } = setup();
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);

    expect(
      picker().getByRole("heading", { name: "Select gifts" }),
    ).toBeInTheDocument();
    expect(container).not.toContainElement(dialog());
    expect(picker().getByPlaceholderText("Search gifts...")).toHaveFocus();
  });

  it("lists the gifts cheapest first, with their coins", async () => {
    await openPicker();

    expect(listed()).toEqual([
      "Heart Me",
      "Rose",
      "Doughnut",
      "Galaxy",
      "Lion",
    ]);
    expect(within(row("Galaxy")).getByText("1,000 coins")).toBeVisible();
    expect(within(row("Rose")).getByText("1 coin")).toBeVisible();
    expect(status()).toHaveTextContent("5 gifts · 0 selected");
  });

  it("lists the gifts picked when it opened first, and keeps them in place", async () => {
    const { user } = await openPicker([1000, 1]);
    const order = ["Rose", "Galaxy", "Heart Me", "Doughnut", "Lion"];
    expect(listed()).toEqual(order);

    // Rows don't move under the pointer.
    await user.click(row("Lion"));
    await user.click(row("Galaxy"));

    expect(checkbox("Lion")).toBeChecked();
    expect(checkbox("Galaxy")).not.toBeChecked();
    expect(listed()).toEqual(order);
  });

  it("searches names", async () => {
    const { user } = await openPicker();
    const search = picker().getByPlaceholderText("Search gifts...");

    await user.type(search, "  RO ");
    expect(listed()).toEqual(["Rose"]);
    expect(status()).toHaveTextContent("1 of 5 gifts · 0 selected");

    await user.clear(search);
    await user.type(search, "zzz");
    expect(listed()).toEqual([]);
    expect(picker().getByText("No gifts match.")).toBeInTheDocument();
  });

  it("filters by coins", async () => {
    const { user } = await openPicker();
    expect(picker().queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(picker().getByText("Any price"));
    await user.click(option("At least"));
    fireEvent.change(coins(), { target: { value: "1000" } });
    expect(listed()).toEqual(["Galaxy", "Lion"]);
    expect(picker().getByText("coins")).toBeInTheDocument();

    await user.click(picker().getByText("At least"));
    await user.click(option("Exactly"));
    fireEvent.change(coins(), { target: { value: "1" } });
    expect(listed()).toEqual(["Heart Me", "Rose"]);
    expect(picker().getByText("coin")).toBeInTheDocument();
  });

  it("filters by a range of coins", async () => {
    const { user } = await openPicker();

    await user.click(picker().getByText("Any price"));
    await user.click(option("Between"));
    fireEvent.change(coins(), { target: { value: "1000" } });
    fireEvent.change(coins("To coins"), { target: { value: "30" } });
    expect(listed()).toEqual(["Doughnut", "Galaxy"]);

    await user.click(picker().getByText("Between"));
    await user.click(option("Any price"));
    expect(picker().queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(listed()).toHaveLength(5);
  });

  it("sorts by price or name", async () => {
    const { user } = await openPicker();

    await user.click(picker().getByText("Cheapest first"));
    await user.click(option("Most expensive first"));
    expect(listed()).toEqual([
      "Lion",
      "Galaxy",
      "Doughnut",
      "Heart Me",
      "Rose",
    ]);

    await user.click(picker().getByText("Most expensive first"));
    await user.click(option("Name, Z to A"));
    expect(listed()).toEqual([
      "Rose",
      "Lion",
      "Heart Me",
      "Galaxy",
      "Doughnut",
    ]);
  });

  it("checks gifts and keeps them on Done", async () => {
    const { user, onChange } = await openPicker([1000]);
    expect(checkbox("Galaxy")).toBeChecked();
    expect(checkbox("Rose")).not.toBeChecked();

    await user.click(row("Rose"));
    await user.click(checkbox("Lion"));
    await user.click(row("Galaxy"));

    expect(checkbox("Rose")).toBeChecked();
    expect(checkbox("Galaxy")).not.toBeChecked();
    expect(status()).toHaveTextContent("5 gifts · 2 selected");
    expect(onChange).not.toHaveBeenCalled();

    await user.click(picker().getByRole("button", { name: "Done" }));

    expect(onChange).toHaveBeenCalledWith([1, 29999]);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("drops the changes on Cancel or Escape", async () => {
    const { user, field, onChange } = await openPicker([1000]);

    await user.click(row("Rose"));
    await user.click(picker().getByRole("button", { name: "Cancel" }));
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);
    expect(checkbox("Rose")).not.toBeChecked();
    expect(checkbox("Galaxy")).toBeChecked();
    await user.click(row("Rose"));
    await user.keyboard("{Escape}");

    expect(dialog()).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("saves nothing when Done changes nothing", async () => {
    const { user, onChange } = await openPicker([1000]);

    await user.click(row("Rose"));
    await user.click(row("Rose"));
    await user.click(picker().getByRole("button", { name: "Done" }));

    expect(dialog()).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects every gift shown, after the ones picked", async () => {
    const { user, onChange } = await openPicker([1]);
    const selectAll = () =>
      picker().getByRole("button", { name: "Select all shown" });

    await user.click(picker().getByText("Any price"));
    await user.click(option("At least"));
    fireEvent.change(coins(), { target: { value: "1000" } });
    expect(selectAll()).toBeEnabled();

    await user.click(selectAll());

    expect(checkbox("Galaxy")).toBeChecked();
    expect(checkbox("Lion")).toBeChecked();
    expect(status()).toHaveTextContent("2 of 5 gifts · 3 selected");
    expect(selectAll()).toBeDisabled();

    await user.click(picker().getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith([1, 1000, 29999]);
  });

  it("clears the selection, gifts the list doesn't have too", async () => {
    const { user, onChange } = await openPicker([1, 30, 999]);
    const clear = () => picker().getByRole("button", { name: "Clear" });
    expect(status()).toHaveTextContent("3 selected");

    await user.click(clear());

    expect(checkbox("Rose")).not.toBeChecked();
    expect(checkbox("Doughnut")).not.toBeChecked();
    expect(status()).toHaveTextContent("0 selected");
    expect(clear()).toBeDisabled();

    await user.click(picker().getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("says when there are no gifts", async () => {
    const { user, field } = setup([], []);

    await user.click(field);

    expect(picker().getByText("No gifts available.")).toBeInTheDocument();
    expect(
      picker().getByRole("button", { name: "Select all shown" }),
    ).toBeDisabled();
    expect(picker().getByRole("button", { name: "Clear" })).toBeDisabled();
  });
});

describe("GiftSelect", () => {
  it("shows the gift, or asks for one", () => {
    const { field, unmount } = setupSingle(30);
    expect(field).toHaveTextContent("Doughnut30 coins");
    unmount();

    expect(setupSingle(undefined).field).toHaveTextContent("Select a gift...");
  });

  it("picks a gift and closes", async () => {
    const { user, field, onChange } = setupSingle(1);

    await user.click(field);
    expect(
      picker().getByRole("heading", { name: "Select a gift" }),
    ).toBeInTheDocument();
    expect(picker().queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      picker().queryByRole("button", { name: "Select all shown" }),
    ).not.toBeInTheDocument();
    expect(
      picker().queryByRole("button", { name: "Done" }),
    ).not.toBeInTheDocument();

    await user.type(picker().getByPlaceholderText("Search gifts..."), "heart");
    await user.click(row("Heart Me"));

    expect(onChange).toHaveBeenCalledWith(8);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("lists the current gift first", async () => {
    const { user, field } = setupSingle(1000);

    await user.click(field);

    expect(listed()).toEqual([
      "Galaxy",
      "Heart Me",
      "Rose",
      "Doughnut",
      "Lion",
    ]);
  });

  it("closes with Cancel without picking", async () => {
    const { user, field, onChange } = setupSingle(1);

    await user.click(field);
    await user.click(picker().getByRole("button", { name: "Cancel" }));

    expect(dialog()).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
