import { OverlayConfigField } from "@/common/schemas";
import { gift } from "@test/fixtures";
import { inList } from "@test/queries";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sameValue, SettingField } from "./SettingField";

const GIFTS = [gift(5655, "Rose"), gift(6064, "GG"), gift(7934, "Heart Me")];

const OPTIONS = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
];

const base = { id: "field", name: "Field", section: "general" };

function setup(field: OverlayConfigField) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <SettingField
      field={field}
      gifts={GIFTS}
      onChange={onChange}
      onReset={onReset}
    />,
  );
  return { ...view, onChange, onReset, user: userEvent.setup() };
}

const reset = () => screen.queryByRole("button", { name: "Reset to default" });

const text = (value: string): OverlayConfigField => ({
  ...base,
  name: "Title",
  type: "input",
  attributes: {
    mode: "text",
    placeholder: "Type a title",
    value,
    default: "Goal",
  },
});

describe("SettingField", () => {
  it("edits text", async () => {
    const { user, onChange } = setup(text("Goal"));
    const input = within(
      screen.getByRole("group", { name: "Title" }),
    ).getByPlaceholderText("Type a title");
    expect(input).toHaveValue("Goal");

    await user.type(input, "!");

    expect(onChange).toHaveBeenCalledWith("Goal!");
  });

  it("can be reset only once it differs from its default", async () => {
    const { unmount } = setup(text("Goal"));
    expect(reset()).toBeDisabled();
    unmount();

    const { user, onReset } = setup(text("Raised"));
    expect(reset()).toBeEnabled();
    await user.click(reset()!);

    expect(onReset).toHaveBeenCalledOnce();
  });

  it("edits numbers as numbers", () => {
    const { onChange } = setup({
      ...base,
      name: "Goal",
      type: "input",
      attributes: { mode: "number", value: 10, default: 10 },
    });
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(10);

    fireEvent.change(input, { target: { value: "25" } });

    expect(onChange).toHaveBeenCalledWith(25);
  });

  it("lets a number be cleared without reporting 0", () => {
    const { onChange } = setup({
      ...base,
      name: "Goal",
      type: "input",
      attributes: { mode: "number", value: 10, default: 10 },
    });
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "" } });

    expect(input).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picks one option of a dropdown", async () => {
    const { user, container, onChange } = setup({
      ...base,
      name: "Position",
      type: "dropdown",
      attributes: {
        multiple: false,
        searchable: false,
        options: OPTIONS,
        value: "top",
        default: "top",
      },
    });

    await user.click(within(container).getByText("Top"));
    await user.click(inList(container, "Left")!);

    expect(onChange).toHaveBeenCalledWith("left");
  });

  it("shows the first value of a list in a single dropdown", () => {
    const { container } = setup({
      ...base,
      type: "dropdown",
      attributes: {
        multiple: false,
        searchable: false,
        options: OPTIONS,
        value: ["bottom", "left"],
        default: ["top"],
      },
    });

    expect(within(container).getByText("Bottom")).toBeInTheDocument();
    expect(within(container).queryByText("Left")).not.toBeInTheDocument();
  });

  it("picks several options of a multiple dropdown", async () => {
    const { user, container, onChange } = setup({
      ...base,
      name: "Sides",
      type: "dropdown",
      attributes: {
        multiple: true,
        searchable: true,
        options: OPTIONS,
        // A single value is a list of one
        value: "top",
        default: ["top"],
      },
    });
    expect(within(container).getByText("Top")).toBeInTheDocument();

    await user.click(within(container).getByText("Top"));
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    await user.click(inList(container, "Left")!);

    expect(onChange).toHaveBeenCalledWith(["top", "left"]);
  });

  it("picks one of the gifts", async () => {
    const { user, container, onChange } = setup({
      ...base,
      name: "Gift",
      type: "gifts",
      attributes: { multiple: false, value: 5655, default: 5655 },
    });
    expect(within(container).getByText("Rose")).toBeInTheDocument();

    await user.click(within(container).getByText("Rose"));
    const picker = within(screen.getByRole("dialog"));
    await user.type(picker.getByPlaceholderText("Search gifts..."), "heart");
    await user.click(picker.getByTitle("Heart Me"));

    expect(onChange).toHaveBeenCalledWith(7934);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("picks several of the gifts", async () => {
    const { user, container, onChange } = setup({
      ...base,
      name: "Gifts",
      type: "gifts",
      attributes: { multiple: true, value: [5655], default: [] },
    });

    await user.click(within(container).getByText("Rose"));
    const picker = within(screen.getByRole("dialog"));
    await user.click(picker.getByTitle("GG"));
    await user.click(picker.getByRole("button", { name: "Done" }));

    expect(onChange).toHaveBeenCalledWith([5655, 6064]);
  });

  it("slides a number and shows it", () => {
    const { onChange } = setup({
      ...base,
      name: "Size",
      type: "slider",
      attributes: { value: 40, default: 50, min: 10, max: 90 },
    });
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "10");
    expect(slider).toHaveAttribute("max", "90");
    expect(slider).toHaveValue("40");
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(reset()).toBeEnabled();

    fireEvent.change(slider, { target: { value: "70" } });

    expect(onChange).toHaveBeenCalledWith(70);
  });

  it("picks a color, without its #", async () => {
    const { user, onChange } = setup({
      ...base,
      name: "Background",
      type: "color",
      attributes: { value: "ff0000", default: "ff0000" },
    });
    expect(reset()).toBeDisabled();

    const background = within(
      screen.getByRole("group", { name: "Background" }),
    );
    await user.click(background.getByRole("button", { name: "Choose color" }));
    const input = screen.getByPlaceholderText("Type a color");
    expect(input).toHaveValue("#ff0000");
    await user.clear(input);
    await user.type(input, "00ff0080");

    expect(onChange).toHaveBeenLastCalledWith("00ff0080");
  });

  it.each(["check", "toggle"] as const)(
    "switches a %s, which has no reset",
    async (type) => {
      const { user, onChange } = setup({
        ...base,
        name: "Show count",
        type,
        attributes: { value: false, default: true },
      });
      const box = screen.getByRole("checkbox", { name: "Show count" });
      expect(box).not.toBeChecked();
      expect(reset()).not.toBeInTheDocument();

      await user.click(box);

      expect(onChange).toHaveBeenCalledWith(true);
    },
  );
});

describe("sameValue", () => {
  it("compares primitives", () => {
    expect(sameValue("a", "a")).toBe(true);
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue(true, false)).toBe(false);
    expect(sameValue(1, "1")).toBe(false);
  });

  it("compares lists by their items, in order", () => {
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue([], [])).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue(["a"], "a")).toBe(false);
  });
});
