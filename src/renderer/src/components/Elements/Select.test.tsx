import { inList } from "@test/queries";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../Modal";
import { MultiSelect, Select, SelectOption } from "./Select";

const GIFTS: SelectOption<number>[] = [
  { value: 1, label: "Rose", img: "rose.png" },
  { value: 2, label: "Lion", img: "lion.png" },
  { value: 3, label: "Heart" },
];

const VOICES: SelectOption<string>[] = [
  { value: "aria", label: "Aria", group: "English" },
  { value: "guy", label: "Guy", group: "English" },
  { value: "dalia", label: "Dalia", group: "Spanish" },
];

const listed = (container: HTMLElement, ...texts: string[]) =>
  texts.filter((text) => inList(container, text) !== null);

describe("Select", () => {
  it("shows the placeholder until there's a value", () => {
    const { rerender } = render(
      <Select options={GIFTS} value={undefined} onChange={vi.fn()} />,
    );
    expect(screen.getByText("Select an option...")).toBeInTheDocument();

    rerender(
      <Select
        options={GIFTS}
        value={undefined}
        onChange={vi.fn()}
        placeholder="Any gift"
      />,
    );
    expect(screen.getByText("Any gift")).toBeInTheDocument();
  });

  it("shows the selected option with its image", () => {
    const { container } = render(
      <Select options={GIFTS} value={2} onChange={vi.fn()} />,
    );

    expect(within(container).getByText("Lion")).toBeInTheDocument();
    expect(within(container).getByRole("img")).toHaveAttribute(
      "src",
      "lion.png",
    );
  });

  it("lists the options and closes after a pick", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <Select options={GIFTS} value={undefined} onChange={onChange} />,
    );

    await user.click(screen.getByText("Select an option..."));
    expect(listed(container, "Rose", "Lion", "Heart")).toHaveLength(3);

    await user.click(inList(container, "Heart")!);

    expect(onChange).toHaveBeenCalledWith(3);
    expect(listed(container, "Rose", "Lion", "Heart")).toHaveLength(0);
  });

  it("puts each group's name above its options", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select options={VOICES} value={undefined} onChange={vi.fn()} />,
    );

    await user.click(screen.getByText("Select an option..."));

    const order = ["English", "Aria", "Guy", "Spanish", "Dalia"].map((text) =>
      inList(container, text)!,
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it("searches option and group names", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select
        searchable
        options={VOICES}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Select an option..."));
    const search = screen.getByPlaceholderText("Search...");
    expect(search).toHaveFocus();

    await user.type(search, "DA");
    expect(listed(container, "English", "Aria", "Spanish", "Dalia")).toEqual([
      "Spanish",
      "Dalia",
    ]);

    await user.clear(search);
    await user.type(search, "english");
    expect(listed(container, "Aria", "Guy", "Dalia")).toEqual(["Aria", "Guy"]);

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText("No options found")).toBeInTheDocument();
  });

  it("starts with an empty search every time it opens", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select
        searchable
        options={VOICES}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    const display = screen.getByText("Select an option...");

    await user.click(display);
    await user.type(screen.getByPlaceholderText("Search..."), "dalia");
    await user.click(display);
    await user.click(display);

    expect(screen.getByPlaceholderText("Search...")).toHaveValue("");
    expect(listed(container, "Aria", "Guy", "Dalia")).toHaveLength(3);
  });

  it("doesn't open while disabled", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select disabled options={GIFTS} value={undefined} onChange={vi.fn()} />,
    );

    await user.click(screen.getByText("Select an option..."));

    expect(listed(container, "Rose")).toHaveLength(0);
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select options={GIFTS} value={undefined} onChange={vi.fn()} />,
    );
    await user.click(screen.getByText("Select an option..."));

    await user.click(document.body);

    expect(listed(container, "Rose")).toHaveLength(0);
  });
});

// The option the arrow keys are on
const current = () => {
  const owner = screen.queryByPlaceholderText("Search...") ?? combobox();
  const id = owner.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};
const combobox = () => screen.getByRole("combobox");

describe("Select from the keyboard", () => {
  it("opens on the selected option, moves with the arrows and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select options={GIFTS} value={2} onChange={onChange} />);

    await user.tab();
    expect(combobox()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    expect(current()).toHaveTextContent("Lion");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(current()).toHaveTextContent("Heart");
    await user.keyboard("{Home}");
    expect(current()).toHaveTextContent("Rose");
    await user.keyboard("{End}{ArrowUp}");
    expect(current()).toHaveTextContent("Lion");

    await user.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledWith(1);
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(combobox()).toHaveFocus();
  });

  it("opens with Space and the arrows too", async () => {
    const user = userEvent.setup();
    render(<Select options={GIFTS} value={undefined} onChange={vi.fn()} />);

    for (const key of [" ", "{ArrowDown}", "{ArrowUp}"]) {
      combobox().focus();
      await user.keyboard(key);
      expect(current()).toHaveTextContent("Rose");
      await user.keyboard("{Escape}");
    }
  });

  it("lists options with roles, the selected one marked", async () => {
    const user = userEvent.setup();
    render(<Select options={GIFTS} value={3} onChange={vi.fn()} />);

    await user.click(combobox());

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: "Heart", selected: true }),
    ).toBeInTheDocument();
  });

  it("skips group names", async () => {
    const user = userEvent.setup();
    render(<Select options={VOICES} value="guy" onChange={vi.fn()} />);
    combobox().focus();

    await user.keyboard("{Enter}{ArrowDown}");
    expect(current()).toHaveTextContent("Dalia");

    await user.keyboard("{ArrowUp}");
    expect(current()).toHaveTextContent("Guy");
  });

  it("moves through the matches from its search, and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select searchable options={VOICES} value="aria" onChange={onChange} />,
    );
    combobox().focus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByPlaceholderText("Search...")).toHaveFocus();
    await user.keyboard("a");
    expect(current()).toHaveTextContent("Aria");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("dalia");
    expect(combobox()).toHaveFocus();
  });

  it("keeps Space for the search's text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        searchable
        options={VOICES}
        value={undefined}
        onChange={onChange}
      />,
    );
    await user.click(combobox());

    await user.keyboard("ar ");

    expect(screen.getByPlaceholderText("Search...")).toHaveValue("ar ");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on Escape without closing the modal it's in", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        <Select options={GIFTS} value={undefined} onChange={vi.fn()} />
      </Modal>,
    );
    combobox().focus();

    await user.keyboard("{Enter}{Escape}");
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(combobox()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when Tab moves on", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Select options={GIFTS} value={undefined} onChange={vi.fn()} />
        <button>Next</button>
      </>,
    );
    combobox().focus();

    await user.keyboard("{Enter}");
    await user.tab();

    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });

  it("keeps the focus when an option is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select options={GIFTS} value={undefined} onChange={vi.fn()} />,
    );

    await user.click(combobox());
    await user.click(inList(container, "Rose")!);

    expect(combobox()).toHaveFocus();
  });

  it("can't be reached while disabled", async () => {
    const user = userEvent.setup();
    render(
      <Select disabled options={GIFTS} value={undefined} onChange={vi.fn()} />,
    );

    await user.tab();

    expect(combobox()).not.toHaveFocus();
    expect(combobox()).toHaveAttribute("aria-disabled", "true");
  });
});

describe("MultiSelect", () => {
  it("shows a chip for each selected option", () => {
    const { container } = render(
      <MultiSelect options={GIFTS} value={[1, 3]} onChange={vi.fn()} />,
    );

    expect(within(container).getByText("Rose")).toBeInTheDocument();
    expect(within(container).getByText("Heart")).toBeInTheDocument();
    expect(within(container).queryByText("Lion")).not.toBeInTheDocument();
  });

  it("toggles options and stays open", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <MultiSelect options={GIFTS} value={[1]} onChange={onChange} />,
    );

    await user.click(within(container).getByText("Rose"));
    await user.click(inList(container, "Lion")!);
    expect(onChange).toHaveBeenLastCalledWith([1, 2]);

    await user.click(inList(container, "Rose")!);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(listed(container, "Heart")).toHaveLength(1);
  });

  it("removes a chip without opening the list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <MultiSelect options={GIFTS} value={[1, 2]} onChange={onChange} />,
    );

    const [removeRose] = within(container).getAllByRole("button");
    await user.click(removeRose);

    expect(onChange).toHaveBeenCalledWith([2]);
    expect(listed(container, "Heart")).toHaveLength(0);
  });

  it("names each chip's remove button", () => {
    render(<MultiSelect options={GIFTS} value={[1, 2]} onChange={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Remove Rose" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Lion" }),
    ).toBeInTheDocument();
  });

  it("toggles options with Enter and stays open", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={GIFTS} value={[1]} onChange={onChange} />);
    combobox().focus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-multiselectable",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith([]);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith([1, 2]);
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves the keys on a chip's button to it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={GIFTS} value={[1, 2]} onChange={onChange} />);

    screen.getByRole("button", { name: "Remove Rose" }).focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith([2]);
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
  });

  it("can't remove chips while disabled", () => {
    const { container } = render(
      <MultiSelect
        disabled
        options={GIFTS}
        value={[1, 2]}
        onChange={vi.fn()}
      />,
    );

    expect(within(container).queryAllByRole("button")).toHaveLength(0);
  });
});
