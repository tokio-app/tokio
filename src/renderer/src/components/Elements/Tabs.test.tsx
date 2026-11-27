import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tabPanel, Tabs } from "./Tabs";

const TABS = [
  { value: "YouTube", label: "YouTube" },
  { value: "Spotify", label: "Spotify", accent: "#1db954" },
];

const THREE = [
  { value: "TikTok", label: "TikTok" },
  { value: "Twitch", label: "Twitch" },
  { value: "Kick", label: "Kick" },
];

function Platforms() {
  const [value, setValue] = useState("TikTok");
  return <Tabs tabs={THREE} value={value} onChange={setValue} />;
}

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

  it("is one stop in the Tab order, the selected tab", () => {
    render(<Tabs tabs={THREE} value="Twitch" onChange={vi.fn()} />);

    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex")),
    ).toEqual(["-1", "0", "-1"]);
  });

  it("puts the first tab in the Tab order while none is selected", () => {
    render(<Tabs tabs={THREE} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "TikTok" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("moves and selects with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    render(<Platforms />);
    const tab = (name: string) => screen.getByRole("tab", { name });
    await user.tab();
    expect(tab("TikTok")).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(tab("Twitch")).toHaveFocus();
    expect(tab("Twitch")).toHaveAttribute("aria-selected", "true");
    expect(tab("Twitch")).toHaveAttribute("tabindex", "0");

    await user.keyboard("{End}");
    expect(tab("Kick")).toHaveFocus();
    // Past the last, back to the first
    await user.keyboard("{ArrowRight}");
    expect(tab("TikTok")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tab("Kick")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tab("TikTok")).toHaveAttribute("aria-selected", "true");
  });

  it("names the panel the tabs control", () => {
    render(
      <Tabs tabs={TABS} value="YouTube" onChange={vi.fn()} panelId="panel" />,
    );

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-controls", "panel");
    }
  });

  it("gives each tab an id its panel is named by", () => {
    render(
      <>
        <Tabs tabs={TABS} value="Spotify" onChange={vi.fn()} panelId="panel" />
        <div {...tabPanel("panel", "Spotify")} />
      </>,
    );

    expect(screen.getByRole("tab", { name: "YouTube" })).toHaveAttribute(
      "id",
      "panel-tab-YouTube",
    );
    expect(screen.getByRole("tabpanel", { name: "Spotify" })).toHaveAttribute(
      "id",
      "panel",
    );
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

    // Only tabs belong in the list
    expect(
      within(screen.getByRole("tablist")).queryAllByRole("button"),
    ).toEqual([]);
    // The other tab's × is for the pointer only
    expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove Spotify" }));
    expect(onClose).toHaveBeenCalledWith("Spotify");

    await user.click(screen.getByTitle("Remove YouTube", { exact: true }));
    expect(onClose).toHaveBeenLastCalledWith("YouTube");
  });

  describe("moving tabs", () => {
    // All stays last
    const MOVABLE = [
      { value: "TikTok", label: "TikTok", movable: true },
      { value: "Twitch", label: "Twitch", movable: true },
      { value: "All", label: "All" },
    ];
    const tab = (name: string) => screen.getByRole("tab", { name });
    const names = () => screen.getAllByRole("tab").map((t) => t.textContent);

    function Reorderable({ onReorder }: { onReorder: (v: string[]) => void }) {
      const [tabs, setTabs] = useState(MOVABLE);
      return (
        <Tabs
          tabs={tabs}
          value="TikTok"
          onChange={vi.fn()}
          onReorder={(values) => {
            onReorder(values);
            setTabs(values.map((v) => MOVABLE.find((t) => t.value === v)!));
          }}
        />
      );
    }

    it("moves the focused tab with Alt and an arrow, never past one that stays", async () => {
      const user = userEvent.setup();
      const onReorder = vi.fn();
      render(<Reorderable onReorder={onReorder} />);
      expect(tab("TikTok")).toHaveAttribute(
        "aria-keyshortcuts",
        "Alt+ArrowLeft Alt+ArrowRight",
      );
      expect(tab("All")).not.toHaveAttribute("aria-keyshortcuts");

      await user.tab();
      await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
      expect(onReorder).toHaveBeenCalledWith(["Twitch", "TikTok", "All"]);
      expect(names()).toEqual(["Twitch", "TikTok", "All"]);
      expect(tab("TikTok")).toHaveFocus();

      await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
      expect(onReorder).toHaveBeenCalledOnce();
      expect(tab("TikTok")).toHaveFocus();
    });

    it("moves a tab dropped on another, and nothing when the drag ends elsewhere", () => {
      const onReorder = vi.fn();
      render(<Reorderable onReorder={onReorder} />);
      expect(tab("TikTok")).toHaveAttribute("draggable", "true");
      expect(tab("All")).not.toHaveAttribute("draggable");

      fireEvent.dragStart(tab("TikTok"), { dataTransfer: {} });
      fireEvent.dragEnter(tab("Twitch"));
      fireEvent.dragEnd(tab("TikTok"));
      expect(onReorder).not.toHaveBeenCalled();

      fireEvent.dragStart(tab("TikTok"), { dataTransfer: {} });
      fireEvent.dragEnter(tab("Twitch"));
      // Not onto All
      fireEvent.dragEnter(tab("All"));
      fireEvent.drop(tab("All"));
      expect(onReorder).toHaveBeenCalledWith(["Twitch", "TikTok", "All"]);
      expect(names()).toEqual(["Twitch", "TikTok", "All"]);
    });

    it("leaves tabs in place without onReorder", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Tabs tabs={MOVABLE} value="TikTok" onChange={onChange} />);
      expect(tab("TikTok")).not.toHaveAttribute("draggable");

      await user.tab();
      await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
      expect(onChange).toHaveBeenCalledWith("Twitch");
    });
  });
});
