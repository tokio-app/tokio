import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import { Modal } from ".";

const dialog = () => within(screen.getByRole("dialog"));
const dropFocus = () =>
  act(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

describe("Modal", () => {
  it("shows its title and description", () => {
    render(
      <Modal
        title="Delete profile?"
        description="This can't be undone."
        onClose={vi.fn()}
      />,
    );

    expect(
      dialog().getByRole("heading", { name: "Delete profile?" }),
    ).toBeInTheDocument();
    expect(dialog().getByText("This can't be undone.")).toBeInTheDocument();
  });

  it("has Cancel and a confirm button when it can be confirmed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Modal
        title="Delete profile?"
        confirmText="Delete"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await user.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(dialog().getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("names the confirm button Confirm by default", () => {
    render(<Modal title="Continue?" onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(
      dialog().getByRole("button", { name: "Confirm" }),
    ).toBeInTheDocument();
  });

  it("puts a custom footer in place of the default one", () => {
    render(
      <Modal
        title="Unsaved changes"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        footer={<button>Discard</button>}
      />,
    );

    expect(
      dialog()
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Discard"]);
  });

  it("has a close button only when asked for one", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Modal title="Settings" onClose={onClose} />);
    expect(
      dialog().queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    rerender(<Modal title="Settings" closeButton onClose={onClose} />);
    await user.click(dialog().getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has no buttons without onConfirm, a footer or a close button", () => {
    render(
      <Modal title="Heads up" description="Read this." onClose={vi.fn()} />,
    );

    expect(dialog().queryAllByRole("button")).toHaveLength(0);
  });

  it("puts actions at the end of the title's row", () => {
    render(
      <Modal
        title="Media"
        onClose={vi.fn()}
        actions={<button>Search</button>}
      />,
    );

    const search = dialog().getByRole("button", { name: "Search" });
    expect(
      dialog().getByRole("heading", { name: "Media" }).parentElement,
    ).toContainElement(search);
  });

  it("renders its children in the body", () => {
    render(
      <Modal title="Rename" onClose={vi.fn()} onConfirm={vi.fn()}>
        <input placeholder="New name" />
      </Modal>,
    );

    expect(dialog().getByPlaceholderText("New name")).toBeInTheDocument();
  });

  it("is named by its title and described by its description", () => {
    render(
      <Modal
        title="Delete profile?"
        description="This can't be undone."
        onClose={vi.fn()}
      />,
    );

    const modal = screen.getByRole("dialog", { name: "Delete profile?" });
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAccessibleDescription("This can't be undone.");
  });

  it("takes the focus, and gives it back when it closes", () => {
    const page = (open: boolean) => (
      <>
        <button>Open</button>
        {open && <Modal title="Settings" onClose={vi.fn()} />}
      </>
    );
    const { rerender } = render(page(false));
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();

    rerender(page(true));
    expect(screen.getByRole("dialog")).toHaveFocus();

    rerender(page(false));
    expect(opener).toHaveFocus();
  });

  it("leaves the focus on a field that asks for it", () => {
    render(
      <Modal title="Rename" onClose={vi.fn()}>
        <input autoFocus placeholder="New name" />
      </Modal>,
    );

    expect(screen.getByPlaceholderText("New name")).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal title="Settings" onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps Tab inside, and still closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <button>Behind</button>
        <Modal title="Delete profile?" onClose={onClose} onConfirm={vi.fn()} />
      </>,
    );
    const cancel = dialog().getByRole("button", { name: "Cancel" });
    const confirm = dialog().getByRole("button", { name: "Confirm" });

    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("goes from the dialog itself to its last control on Shift+Tab", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Behind</button>
        <Modal title="Delete profile?" onClose={vi.fn()} onConfirm={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();

    await user.tab({ shift: true });

    expect(dialog().getByRole("button", { name: "Confirm" })).toHaveFocus();
  });

  it("lets Tab reach a video's controls, and wraps after them", () => {
    render(
      <Modal title="Full size" onClose={vi.fn()} closeButton>
        <video controls aria-label="Clip" />
      </Modal>,
    );
    const close = dialog().getByRole("button", { name: "Close" });
    const video = dialog().getByLabelText("Clip");
    close.focus();

    // The browser moves into the controls, which jsdom doesn't have.
    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(true);
    expect(close).toHaveFocus();

    // Chromium reports the video while its controls have the focus.
    const active = vi
      .spyOn(Document.prototype, "activeElement", "get")
      .mockReturnValue(video);
    expect(fireEvent.keyDown(video, { key: "Tab" })).toBe(false);
    active.mockRestore();
    expect(close).toHaveFocus();
  });

  it("skips a disabled button both ways", async () => {
    const user = userEvent.setup();
    render(
      <Modal
        title="Rename"
        onClose={vi.fn()}
        closeButton
        footer={
          <>
            <button>Cancel</button>
            <button disabled>Save</button>
            <button>Help</button>
          </>
        }
      />,
    );
    const cancel = dialog().getByRole("button", { name: "Cancel" });
    const help = dialog().getByRole("button", { name: "Help" });
    cancel.focus();

    await user.tab();
    expect(help).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it("makes the page behind inert, but not what stays over dialogs", () => {
    const page = (open: boolean) => (
      <>
        <button>Behind</button>
        <div data-over-dialogs>
          <button>Minimize</button>
        </div>
        {open && <Modal title="Settings" onClose={vi.fn()} />}
      </>
    );
    const { rerender } = render(page(true));
    const behind = screen.getByText("Behind");

    expect(behind).toHaveAttribute("inert");
    expect(screen.getByText("Minimize")).not.toHaveAttribute("inert");
    expect(screen.getByRole("dialog")).not.toHaveAttribute("inert");

    rerender(page(false));
    expect(behind).not.toHaveAttribute("inert");
  });

  it("leaves the page live before the layout effects of what closed it", () => {
    // What a layout effect saw inert once the dialog closed
    const seen: Element[][] = [];
    function Page({ open }: { open: boolean }) {
      useLayoutEffect(() => {
        if (!open) seen.push([...document.querySelectorAll("[inert]")]);
      }, [open]);
      return (
        <>
          <button>Next row</button>
          {open && <Modal title="Delete alert?" onClose={vi.fn()} />}
        </>
      );
    }
    const { rerender } = render(<Page open />);

    rerender(<Page open={false} />);

    // So useFocusAfterDelete can focus the next row
    expect(seen).toEqual([[]]);
  });

  it("makes a lower dialog inert while one is open over it", () => {
    const stack = (picker: boolean) => (
      <Modal title="Edit alert" onClose={vi.fn()}>
        <button>Pick a sound</button>
        {picker && <Modal title="Select a sound" onClose={vi.fn()} />}
      </Modal>
    );
    const { rerender } = render(stack(true));
    const pick = screen.getByText("Pick a sound");

    expect(pick).toHaveAttribute("inert");
    expect(
      screen.getByRole("dialog", { name: "Select a sound" }),
    ).not.toHaveAttribute("inert");

    rerender(stack(false));
    expect(pick).not.toHaveAttribute("inert");
  });

  it("still takes Escape and Tab after its focused control leaves", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Rows() {
      const [rows, setRows] = useState(["Gift", "Follow"]);
      return rows.map((row) => (
        <button
          key={row}
          onClick={() => setRows((r) => r.filter((x) => x !== row))}
        >
          {`Remove ${row}`}
        </button>
      ));
    }
    render(
      <Modal title="Edit alert" onClose={onClose}>
        <Rows />
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Remove Gift" }));
    // Chromium drops the focus on <body>, jsdom keeps it
    dropFocus();
    expect(document.body).toHaveFocus();

    // Before the dialog takes the focus back on its own
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Remove Follow" })).toHaveFocus();

    dropFocus();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes the focus back when it falls on <body>", async () => {
    render(<Modal title="Settings" onClose={vi.fn()} />);

    dropFocus();

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("gives the focus to the dialog under it when its opener left", () => {
    const stack = (sound: boolean, confirm: boolean) => (
      <Modal title="Select a sound" onClose={vi.fn()}>
        {sound && <button>Delete</button>}
        {confirm && <Modal title="Delete sound?" onClose={vi.fn()} />}
      </Modal>
    );
    const { rerender } = render(stack(true, false));
    screen.getByRole("button", { name: "Delete" }).focus();
    rerender(stack(true, true));
    // Deleted, with its button
    rerender(stack(false, false));

    expect(
      screen.getByRole("dialog", { name: "Select a sound" }),
    ).toHaveFocus();
  });

  it("gives the focus to the page when its opener left", () => {
    const page = (about: boolean, tour: boolean) => (
      <main tabIndex={-1}>
        {about && <button>Take the tour</button>}
        {tour && <Modal title="Welcome to Tokio" onClose={vi.fn()} />}
      </main>
    );
    const { rerender } = render(page(true, false));
    screen.getByRole("button", { name: "Take the tour" }).focus();
    rerender(page(true, true));
    rerender(page(false, true));
    rerender(page(false, false));

    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("closes only the innermost dialog on Escape", async () => {
    const user = userEvent.setup();
    const closeSound = vi.fn();
    const closeVoice = vi.fn();
    // A picker portaled over the modal it was opened from
    const sounds = (voices: boolean) => (
      <Modal title="Select a sound" onClose={closeSound}>
        {voices &&
          createPortal(
            <Modal title="Select a voice" onClose={closeVoice} />,
            document.body,
          )}
      </Modal>
    );
    const { rerender } = render(sounds(false));
    rerender(sounds(true));

    await user.keyboard("{Escape}");
    expect(closeVoice).toHaveBeenCalledOnce();
    expect(closeSound).not.toHaveBeenCalled();

    rerender(sounds(false));
    await user.keyboard("{Escape}");
    expect(closeSound).toHaveBeenCalledOnce();
  });
});
