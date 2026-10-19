import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Input, Textarea } from "./Input";

describe("Input", () => {
  it("is a text input by default", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input placeholder="@username" onChange={onChange} />);

    const input = screen.getByPlaceholderText("@username");
    expect(input).toHaveAttribute("type", "text");

    await user.type(input, "ab");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps its own type and adds its class to the shared one", () => {
    render(<Input type="number" className="level" />);

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveClass("level");
    expect(input.classList).toHaveLength(2);
  });

  it("forwards its ref, so variables can be put at its cursor", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} defaultValue="Hi" />);

    expect(ref.current).toBe(screen.getByRole("textbox"));
  });
});

describe("Textarea", () => {
  it("is a text area with the input's styles", () => {
    render(<Textarea className="list" placeholder="word1, word2" />);

    const area = screen.getByPlaceholderText("word1, word2");
    expect(area.tagName).toBe("TEXTAREA");
    expect(area).toHaveClass("list");
    expect(area.classList).toHaveLength(3);
  });
});
