import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Btn } from "./Btn";

describe("Btn", () => {
  it("is a plain button that passes its props on", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Btn title="Save changes" onClick={onClick}>
        Save
      </Btn>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "Save changes");

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps the type it's given", () => {
    render(<Btn type="submit">Create</Btn>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("doesn't fire while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Btn disabled onClick={onClick}>
        Save
      </Btn>,
    );

    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner instead of its label while loading", () => {
    const { rerender } = render(<Btn>Connect</Btn>);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");

    rerender(<Btn loading>Connect</Btn>);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toHaveTextContent("Connect");
  });

  it("doesn't submit its form while loading", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <Btn type="submit" loading>
          Create
        </Btn>
      </form>,
    );

    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  // CSS only holds the pointer back
  it("ignores Enter and Space while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Btn loading onClick={onClick}>
        Connect
      </Btn>,
    );

    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });
});
