import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, Field, FormGrid, Page, Section } from ".";

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
        title="Official Overlays"
        icon={<button aria-label="Back">{"<"}</button>}
      />,
    );

    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("<Official Overlays");
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
        <Field label="Max Queue Length">
          <input />
        </Field>
      </FormGrid>,
    );

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByText("Max Queue Length")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows its text", () => {
    render(<EmptyState>No alerts yet.</EmptyState>);

    expect(screen.getByText("No alerts yet.")).toBeInTheDocument();
  });
});
