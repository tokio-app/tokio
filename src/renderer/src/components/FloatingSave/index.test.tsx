import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FloatingSave } from ".";

const save = () => screen.getByRole("button", { name: "Save changes" });

describe("FloatingSave", () => {
  it("is disabled while there's nothing to save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<FloatingSave visible={false} onSave={onSave} />);

    expect(save()).toBeDisabled();
    await user.click(save());

    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves when clicked while visible", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<FloatingSave visible onSave={onSave} />);

    expect(save()).toBeEnabled();
    await user.click(save());

    expect(onSave).toHaveBeenCalledOnce();
  });
});
