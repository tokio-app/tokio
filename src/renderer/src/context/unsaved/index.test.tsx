import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { UnsavedEditor, UnsavedProvider } from ".";

const editor = (patch: Partial<UnsavedEditor> = {}) => ({
  label: "TTS",
  isDirty: () => true,
  save: vi.fn(async () => true),
  discard: vi.fn(),
  ...patch,
});

// A page that registers `editor` and tries to leave
function Page({ editor }: { editor?: UnsavedEditor }) {
  const { register, confirmDiscard } = useUnsavedChanges();
  const [result, setResult] = useState("");

  useEffect(() => (editor ? register(editor) : undefined), [editor, register]);

  return (
    <>
      <button onClick={async () => setResult(String(await confirmDiscard()))}>
        Leave
      </button>
      <output>{result}</output>
    </>
  );
}

function setup(page?: UnsavedEditor) {
  render(
    <UnsavedProvider>
      <Page editor={page} />
    </UnsavedProvider>,
  );
  return userEvent.setup();
}

const leave = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Leave" }));

describe("UnsavedProvider", () => {
  it("goes on without asking when no page has settings", async () => {
    const user = setup();

    await leave(user);

    expect(screen.getByRole("status")).toHaveTextContent("true");
  });

  it("goes on without asking when nothing changed", async () => {
    const user = setup(editor({ isDirty: () => false }));

    await leave(user);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });

  it("asks about the editor's changes, and Cancel stays", async () => {
    const page = editor();
    const user = setup(page);

    await leave(user);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "You have unsaved TTS settings. Save them before continuing?",
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("false");
    expect(page.discard).not.toHaveBeenCalled();
    expect(page.save).not.toHaveBeenCalled();
  });

  it("drops the changes on Discard", async () => {
    const page = editor();
    const user = setup(page);

    await leave(user);
    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(page.discard).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });

  it("goes on once Save succeeds, loading meanwhile", async () => {
    let finish!: (saved: boolean) => void;
    const page = editor({
      save: vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve))),
    });
    const user = setup(page);

    await leave(user);
    const save = screen.getByRole("button", { name: "Save" });
    await user.click(save);
    expect(save).toHaveAttribute("aria-busy", "true");

    await act(async () => finish(true));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });

  it("stays when saving fails", async () => {
    const page = editor({ save: vi.fn(async () => false) });
    const user = setup(page);

    await leave(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("unregistering removes only that editor", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UnsavedProvider>{children}</UnsavedProvider>
    );
    const { result } = renderHook(() => useUnsavedChanges(), { wrapper });

    const unregisterOld = result.current.register(editor({ label: "Music" }));
    const unregisterNew = result.current.register(editor({ label: "TTS" }));
    unregisterOld();

    act(() => {
      void result.current.confirmDiscard();
    });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "unsaved TTS settings",
    );

    unregisterNew();
    await act(async () => {
      await expect(result.current.confirmDiscard()).resolves.toBe(true);
    });
  });

  it("is required by useUnsavedChanges", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useUnsavedChanges())).toThrow(
      "useUnsavedChanges must be used within an UnsavedProvider",
    );
  });
});
