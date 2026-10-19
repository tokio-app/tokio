import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ListTextarea } from "./ListTextarea";

// Holds the list, like a settings page does
function Words({
  initial,
  onChange,
}: {
  initial: string[];
  onChange: (items: string[]) => void;
}) {
  const [items, setItems] = useState(initial);
  return (
    <>
      <ListTextarea
        placeholder="word1, word2"
        value={items}
        onChange={(next) => {
          setItems(next);
          onChange(next);
        }}
      />
      <button onClick={() => setItems(["loaded", "profile"])}>Load</button>
    </>
  );
}

const area = () => screen.getByPlaceholderText("word1, word2");

describe("ListTextarea", () => {
  it("shows the list as comma separated text", () => {
    render(<Words initial={["brb", "gg"]} onChange={vi.fn()} />);

    expect(area()).toHaveValue("brb, gg");
  });

  it("keeps the text as typed and reports the list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Words initial={[]} onChange={onChange} />);

    await user.type(area(), "brb, ");

    expect(area()).toHaveValue("brb, ");
    expect(onChange).toHaveBeenLastCalledWith(["brb"]);
  });

  it("replaces the text when the list changes from outside", async () => {
    const user = userEvent.setup();
    render(<Words initial={["brb"]} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(area()).toHaveValue("loaded, profile");
  });
});
