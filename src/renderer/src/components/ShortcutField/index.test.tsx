import { APP_EVENTS } from "@/common/types";
import { sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutField } from ".";

const suspends = () =>
  sent(APP_EVENTS.SUSPEND_SHORTCUTS).map((d) => d.suspended);

function setup(value = "") {
  const onChange = vi.fn();
  const app = renderWithProviders(
    <ShortcutField value={value} onChange={onChange} />,
  );
  const field = () => screen.getByTitle("Change shortcut");
  return { ...app, onChange, field };
}

describe("ShortcutField", () => {
  it("shows the shortcut, or that none is set", () => {
    const { unmount } = setup("Ctrl+Shift+S");
    expect(screen.getByTitle("Change shortcut")).toHaveTextContent(
      "Ctrl + Shift + S",
    );
    unmount();

    setup();
    expect(screen.getByTitle("Change shortcut")).toHaveTextContent("Not set");
    expect(screen.queryByTitle("Remove shortcut")).not.toBeInTheDocument();
  });

  it("suspends Tokio's shortcuts while it records, and records a combination", async () => {
    const { user, onChange, field } = setup();

    await user.click(field());
    expect(field()).toHaveAttribute("aria-pressed", "true");
    expect(field()).toHaveTextContent("Press the keys");
    expect(
      screen.getByText("Esc cancels. Backspace removes the shortcut."),
    ).toBeVisible();
    expect(suspends()).toEqual([true]);

    await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith("Ctrl+Shift+K");
    expect(field()).toHaveAttribute("aria-pressed", "false");
    expect(suspends()).toEqual([true, false]);
  });

  it("keeps recording after a refused press, and says why", async () => {
    const { user, onChange, field } = setup();
    await user.click(field());

    await user.keyboard("{Control>}c{/Control}");

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /^Hold Ctrl and one more modifier with it, such as Shift\./,
      ),
    ).toHaveAttribute("aria-live", "polite");
    expect(field()).toHaveAttribute("aria-pressed", "true");
    expect(suspends()).toEqual([true]);

    await user.keyboard("{Control>}{Shift>}{F8}{/Shift}{/Control}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Ctrl+Shift+F8");
  });

  it("cancels on Escape, without the Escape reaching a dialog or the page", async () => {
    const outer = vi.fn();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <div onKeyDown={(e) => outer(e.key)}>
        <ShortcutField value="F8" onChange={onChange} />
      </div>,
    );
    await user.click(screen.getByTitle("Change shortcut"));

    await user.keyboard("{Escape}");

    expect(outer).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTitle("Change shortcut")).toHaveTextContent("F8");
    expect(suspends()).toEqual([true, false]);

    // Not recording, Escape is the page's again
    await user.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledWith("Escape");
  });

  it("clears the shortcut with Backspace or Delete alone", async () => {
    const { user, onChange, field } = setup("F8");

    await user.click(field());
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith("");

    await user.click(field());
    await user.keyboard("{Delete}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(suspends()).toEqual([true, false, true, false]);
  });

  it("clears it with its button", async () => {
    const { user, onChange } = setup("F8");

    await user.click(screen.getByTitle("Remove shortcut"));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
    expect(suspends()).toEqual([]);
  });

  it("stops recording when it loses the focus, or leaves", async () => {
    const { user, field, unmount } = setup();

    await user.click(field());
    await user.tab();
    expect(field()).toHaveAttribute("aria-pressed", "false");
    expect(suspends()).toEqual([true, false]);

    await user.click(field());
    unmount();
    expect(suspends()).toEqual([true, false, true, false]);
  });

  it("refuses AltGr", async () => {
    const { user, field, onChange } = setup();
    await user.click(field());

    fireEvent.keyDown(field(), {
      key: "@",
      code: "KeyQ",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText("AltGr types characters, so shortcuts can't use it."),
    ).toBeVisible();
  });
});
