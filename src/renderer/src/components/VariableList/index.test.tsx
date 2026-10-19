import { Input } from "@/components/Elements/Input";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { VariableList } from ".";

// Owns the message, like the alert form does
function Message({
  initial = "",
  variables = ["username", "gift"],
  empty,
}: {
  initial?: string;
  variables?: string[];
  empty?: string;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Input
        ref={ref}
        aria-label="Message"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <VariableList
        variables={variables}
        inputRef={ref}
        value={value}
        onChange={setValue}
        empty={empty}
      />
    </>
  );
}

function setup(initial: string) {
  const user = userEvent.setup();
  render(<Message initial={initial} />);
  return { user, input: screen.getByRole<HTMLInputElement>("textbox") };
}

const variable = (name: string) =>
  screen.getByRole("button", { name: `{${name}}` });

// Focuses the input with `start` to `end` selected
const select = (input: HTMLInputElement, start: number, end = start) =>
  act(() => {
    input.focus();
    input.setSelectionRange(start, end);
  });

// The caret is placed on the next frame
const caretAt = (input: HTMLInputElement, position: number) =>
  waitFor(() => {
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(position);
    expect(input.selectionEnd).toBe(position);
  });

describe("VariableList", () => {
  it("lists the variables as buttons", () => {
    render(<Message />);

    expect(screen.getByText("Variables:")).toBeInTheDocument();
    expect(variable("username")).toHaveAttribute("title", "Insert {username}");
    expect(variable("gift")).toBeInTheDocument();
  });

  it("renders nothing without variables", () => {
    render(<Message variables={[]} />);

    expect(screen.queryByText("Variables:")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the empty text without variables when given one", () => {
    render(<Message variables={[]} empty="This trigger has no variables." />);

    expect(
      screen.getByText("This trigger has no variables."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Variables:")).not.toBeInTheDocument();
  });

  it("adds a variable at the end while the input isn't focused", async () => {
    const { user, input } = setup("Thanks ");

    await user.click(variable("username"));

    expect(input).toHaveValue("Thanks {username}");
    await caretAt(input, 17);
  });

  it("inserts a variable at the cursor", async () => {
    const { user, input } = setup("Thanks for the !");
    select(input, 15);

    await user.click(variable("gift"));

    expect(input).toHaveValue("Thanks for the {gift}!");
    await caretAt(input, 21);
  });

  it("replaces the selected text", async () => {
    const { user, input } = setup("Hello world");
    select(input, 6, 11);

    await user.click(variable("username"));

    expect(input).toHaveValue("Hello {username}");
    await caretAt(input, 16);
  });

  it("replaces a variable the cursor sits inside", async () => {
    const { user, input } = setup("Hi {gift}!");
    select(input, 5);

    await user.click(variable("username"));

    expect(input).toHaveValue("Hi {username}!");
    await caretAt(input, 13);
  });

  it("widens a selection that ends inside a variable", async () => {
    const { user, input } = setup("Hi {gift} and {username}");
    select(input, 1, 17);

    await user.click(variable("gift"));

    expect(input).toHaveValue("H{gift}");
    await caretAt(input, 7);
  });

  it("inserts next to a variable when the cursor is at its edge", async () => {
    const { user, input } = setup("{gift}");
    select(input, 0);

    await user.click(variable("username"));

    expect(input).toHaveValue("{username}{gift}");
    await caretAt(input, 10);
  });
});
