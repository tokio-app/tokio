import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FontSelect } from ".";
import styles from "../GiftSelect/giftselect.module.css";

// Faces as queryLocalFonts gives them: a family for each, out of order, and
// a name too long to save
const FACES = ["Verdana", "Arial", "Bebas Neue", "Arial", "x".repeat(61)];

function setup(
  value = "",
  list = async () => FACES.map((family) => ({ family })),
) {
  vi.stubGlobal("queryLocalFonts", vi.fn(list));
  const onChange = vi.fn();
  const view = render(<FontSelect value={value} onChange={onChange} />);
  // The field is the only thing rendered in place, the picker is portaled
  const field = within(view.container).getByRole("button");
  return { ...view, onChange, field, user: userEvent.setup() };
}

const dialog = () => screen.queryByRole("dialog");
const picker = () => within(screen.getByRole("dialog"));
const row = (name: string) => picker().getByRole("button", { name });
const face = (font: string) => `"${font}", "Archivo Variable", sans-serif`;

// The fonts in the picker's list, in order. Its rows are titled by them.
const listed = () =>
  picker()
    .queryAllByTitle(/./)
    .map((el) => el.title);

async function openPicker(value?: string) {
  const view = setup(value);
  await view.user.click(view.field);
  await picker().findByRole("button", { name: "Arial" });
  return view;
}

describe("FontSelect", () => {
  it("shows the font in its own face, Archivo when there's none", () => {
    const { field, unmount } = setup();
    expect(field).toHaveTextContent("Archivo (default)");
    expect(within(field).getByText("Archivo (default)").style.fontFamily).toBe(
      "",
    );
    unmount();

    const bebas = setup("Bebas Neue").field;
    expect(bebas).toHaveAttribute("title", "Bebas Neue");
    expect(within(bebas).getByText("Bebas Neue").style.fontFamily).toBe(
      face("Bebas Neue"),
    );
  });

  it("lists Archivo, then this computer's fonts A to Z, with the one in use first", async () => {
    await openPicker("Verdana");

    expect(listed()).toEqual([
      "Verdana",
      "Archivo (default)",
      "Arial",
      "Bebas Neue",
    ]);
    expect(row("Verdana")).toHaveClass(styles.current);
    expect(row("Arial")).not.toHaveClass(styles.current);
    expect(row("Arial").style.fontFamily).toBe(face("Arial"));
    expect(row("Archivo (default)").style.fontFamily).toBe("");
  });

  it("searches the fonts by name", async () => {
    const { user } = await openPicker();
    const search = picker().getByPlaceholderText("Search fonts...");

    await user.type(search, "BE");
    expect(listed()).toEqual(["Bebas Neue"]);

    await user.type(search, "x");
    expect(listed()).toEqual([]);
    expect(picker().getByText("No fonts match.")).toBeInTheDocument();
  });

  it("picks a font and closes, Archivo as no font", async () => {
    const { user, field, onChange } = await openPicker("Verdana");

    await user.click(row("Bebas Neue"));
    expect(onChange).toHaveBeenLastCalledWith("Bebas Neue");
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);
    await user.click(row("Archivo (default)"));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(dialog()).not.toBeInTheDocument();
  });

  it("saves nothing for the font in use, Cancel or Escape", async () => {
    const { user, field, onChange } = await openPicker("Arial");

    await user.click(row("Arial"));
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);
    await user.click(row("Cancel"));
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);
    await user.keyboard("{Escape}");
    expect(dialog()).not.toBeInTheDocument();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a spinner while it lists the fonts", async () => {
    const { user, field } = setup("", () => new Promise(() => {}));

    await user.click(field);

    expect(
      picker().getByRole("status", { name: "Loading" }),
    ).toBeInTheDocument();
    expect(listed()).toEqual(["Archivo (default)"]);
  });

  it("says when it can't list the fonts, and keeps Archivo", async () => {
    const { user, field } = setup("", async () => {
      throw new Error("Permission denied");
    });

    await user.click(field);

    expect(
      await picker().findByText("Couldn't load this computer's fonts."),
    ).toBeInTheDocument();
    expect(listed()).toEqual(["Archivo (default)"]);
  });
});
