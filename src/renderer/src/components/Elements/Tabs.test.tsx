import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

const TABS = [
  { value: "YouTube", label: "YouTube" },
  { value: "Spotify", label: "Spotify", accent: "#1db954" },
];

describe("Tabs", () => {
  it("selects the tab with the value", () => {
    render(<Tabs tabs={TABS} value="Spotify" onChange={vi.fn()} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "YouTube" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "Spotify" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("selects none while the value is null", () => {
    render(<Tabs tabs={TABS} value={null} onChange={vi.fn()} />);

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-selected", "false");
    }
  });

  it("reports the tab picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="YouTube" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Spotify" }));

    expect(onChange).toHaveBeenCalledWith("Spotify");
  });

  // e.g. the Music provider while connected
  it("ignores the keyboard while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="YouTube" onChange={onChange} disabled />);

    screen.getByRole("tab", { name: "Spotify" }).focus();
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    for (const tab of screen.getAllByRole("tab")) expect(tab).toBeDisabled();
  });

  it("closes a tab from its ×, the open tab's the one in the Tab order", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const closable = TABS.map((tab) => ({
      ...tab,
      onClose: () => onClose(tab.value),
      closeLabel: `Remove ${tab.value}`,
    }));
    render(<Tabs tabs={closable} value="Spotify" onChange={vi.fn()} />);

    // The other tab's × is for the pointer only
    expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove Spotify" }));
    expect(onClose).toHaveBeenCalledWith("Spotify");

    await user.click(screen.getByTitle("Remove YouTube", { exact: true }));
    expect(onClose).toHaveBeenLastCalledWith("YouTube");
  });
});
