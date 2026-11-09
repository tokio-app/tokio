import { MESSAGES } from "@/common/i18n";
import { REPOSITORY_URL } from "@/common/util";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNew } from ".";

// This version's notes, replaced while each test runs
const NOTES = `releases.${__APP_VERSION__}`;
const notes = (count: number) =>
  Array.from({ length: count }, (_, i) => `Note ${i + 1}.`);

beforeEach(() => {
  MESSAGES.en[NOTES] = notes(5).join("\n");
});

afterEach(() => {
  delete MESSAGES.en[NOTES];
});

const dialog = () => within(screen.getByRole("dialog", { name: "What's new" }));
// The notes of the page shown: the others are hidden
const shown = () =>
  dialog()
    .getAllByRole("listitem")
    .map((item) => item.textContent);

describe("WhatsNew", () => {
  it("shows the version's notes a few per page", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    MESSAGES.en[NOTES] = notes(7).join("\n");
    render(<WhatsNew from="0.0.1" onClose={onClose} />);

    expect(dialog().getByText(`Version ${__APP_VERSION__}`)).toBeVisible();
    expect(shown()).toEqual(notes(4));
    expect(dialog().getByText("1 of 2")).toBeVisible();
    expect(
      dialog().queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();

    await user.click(dialog().getByRole("button", { name: "Next" }));
    expect(shown()).toEqual(notes(7).slice(4));
    expect(dialog().getByText("2 of 2")).toBeVisible();

    // Back leaves with the first page, so the focus goes to Next
    await user.click(dialog().getByRole("button", { name: "Back" }));
    expect(shown()).toEqual(notes(4));
    expect(dialog().getByRole("button", { name: "Next" })).toHaveFocus();

    await user.click(dialog().getByRole("button", { name: "Next" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(dialog().getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("puts five notes on one page, with only Done", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WhatsNew from="0.0.1" onClose={onClose} />);

    expect(shown()).toEqual(notes(5));
    expect(dialog().queryByText("1 of 1")).not.toBeInTheDocument();
    expect(
      dialog().queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();

    await user.click(dialog().getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("links the version's whole release notes on GitHub", () => {
    render(<WhatsNew from="0.0.1" onClose={vi.fn()} />);

    expect(
      dialog().getByRole("link", { name: "Release notes on GitHub" }),
    ).toHaveAttribute(
      "href",
      `${REPOSITORY_URL}/releases/tag/v${__APP_VERSION__}`,
    );
  });

  it("shows nothing when the version has no notes", () => {
    delete MESSAGES.en[NOTES];
    render(<WhatsNew from="0.0.1" onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
