import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, Field, FormGrid, Page, Section } from ".";
import { Input, NumberInput, Select } from "../Elements";
import { Modal } from "../Modal";

describe("Page", () => {
  it("renders its sections", () => {
    render(
      <Page width="wide">
        <Section title="Alerts" />
        <Section title="Queue" />
      </Page>,
    );

    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Alerts",
      "Queue",
    ]);
  });

  it("drops the max width only when full", () => {
    const { container, rerender } = render(<Page>{null}</Page>);
    expect(container.firstElementChild!.className).not.toMatch(/page_full/);

    rerender(<Page width="full">{null}</Page>);

    expect(container.firstElementChild!.className).toMatch(/page_full/);
    expect(container.firstElementChild!.className).not.toMatch(/page_wide/);
  });
});

describe("Section", () => {
  it("has no header without a title, description or actions", () => {
    render(
      <Section icon={<span>*</span>}>
        <p>Content</p>
      </Section>,
    );

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("has a header with only a description", () => {
    render(<Section description="Who can use TTS." />);

    expect(screen.getByRole("banner")).toHaveTextContent("Who can use TTS.");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("has a header with only actions", () => {
    render(<Section actions={<button>Add Alert</button>} />);

    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Add Alert",
      }),
    ).toBeInTheDocument();
  });

  it("shows the title, description and actions in its header", () => {
    render(
      <Section
        title="Permissions"
        description="Who can use TTS."
        actions={<button>Reset</button>}
      >
        <p>Content</p>
      </Section>,
    );

    const header = within(screen.getByRole("banner"));
    expect(
      header.getByRole("heading", { name: "Permissions" }),
    ).toBeInTheDocument();
    expect(header.getByText("Who can use TTS.")).toBeInTheDocument();
    expect(header.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(header.queryByText("Content")).not.toBeInTheDocument();
  });

  it("puts the icon before the title", () => {
    render(
      <Section
        title="Official overlays"
        icon={<button aria-label="Back">{"<"}</button>}
      />,
    );

    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("<Official overlays");
    expect(heading.firstChild).toBe(
      screen.getByRole("button", { name: "Back" }),
    );
  });
});

describe("Field", () => {
  it("shows its label, hint and control", () => {
    render(
      <Field label="Cooldown" hint="(seconds)">
        <input type="number" defaultValue={2} />
      </Field>,
    );

    // The hint sits inside the label
    expect(screen.getByText("Cooldown")).toContainElement(
      screen.getByText("(seconds)"),
    );
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
  });

  it("names its group after the label", () => {
    render(
      <Field label="Cooldown" hint="(seconds)">
        <input type="number" />
      </Field>,
    );

    const group = screen.getByRole("group", { name: /Cooldown/ });
    expect(within(group).getByRole("spinbutton")).toBeInTheDocument();
  });

  it("ties its label to its one control, which a click on it focuses", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Cooldown" hint="(seconds)">
        <NumberInput value={2} onChange={vi.fn()} />
      </Field>,
    );

    await user.click(screen.getByText("Cooldown"));

    expect(screen.getByRole("spinbutton", { name: /^Cooldown/ })).toHaveFocus();
  });

  it("names a Select it holds, and focuses it on a click", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Voice">
        <Select options={[]} value={undefined} onChange={vi.fn()} />
      </Field>,
    );

    await user.click(screen.getByText("Voice"));

    expect(screen.getByRole("combobox", { name: "Voice" })).toHaveFocus();
  });

  it("ties its label to no control when it has two", () => {
    render(
      <Field label="Range">
        <Input placeholder="From" />
        <Input placeholder="To" />
      </Field>,
    );

    expect(screen.getByText("Range")).not.toHaveAttribute("for");
    expect(screen.getByRole("group", { name: "Range" })).toBeInTheDocument();
  });

  it("doesn't name the controls of a dialog opened from it", () => {
    render(
      <Field label="Font">
        <Modal title="Fonts" onClose={vi.fn()}>
          <Input placeholder="Search fonts..." />
        </Modal>
      </Field>,
    );

    expect(screen.getByText("Font")).not.toHaveAttribute("for");
    expect(screen.getByPlaceholderText("Search fonts...")).toHaveProperty(
      "labels.length",
      0,
    );
  });

  it("shows only the control without a label", () => {
    const { container } = render(
      <Field hint="(seconds)">
        <input type="number" />
      </Field>,
    );

    expect(screen.queryByText("(seconds)")).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("");
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });
});

describe("FormGrid", () => {
  it("renders its fields", () => {
    render(
      <FormGrid>
        <Field label="Cooldown">
          <input />
        </Field>
        <Field label="Max queue length">
          <input />
        </Field>
      </FormGrid>,
    );

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByText("Max queue length")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows its text", () => {
    render(<EmptyState>No alerts yet.</EmptyState>);

    expect(screen.getByText("No alerts yet.")).toBeInTheDocument();
  });
});
