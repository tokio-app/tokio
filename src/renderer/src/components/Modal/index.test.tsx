import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import { Modal } from ".";

const dialog = () => within(screen.getByRole("dialog"));

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
