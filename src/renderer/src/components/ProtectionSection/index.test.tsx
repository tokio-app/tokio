import { defaultProfile } from "@/common/util";
import { useImmerState } from "@/hooks/useImmerState";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ProtectionSection } from ".";

type Protection = { cooldown: number; queue_length: number };

// Every value the section was rendered with
const states: Protection[] = [];
const current = () => states.at(-1)!;

// Holds the limits, like the TTS and Music pages do
function ProtectionForm({
  feature = "TTS",
  children,
}: {
  feature?: "TTS" | "Music";
  children?: ReactNode;
}) {
  const [protection, update] = useImmerState(() =>
    structuredClone(defaultProfile.music.protection),
  );
  states.push(protection);
  return (
    <ProtectionSection
      protection={protection}
      update={update}
      feature={feature}
    >
      {children}
    </ProtectionSection>
  );
}

// The control under a field's label
const field = (label: string) =>
  within(screen.getByText(label).parentElement!).getByRole("spinbutton");

beforeEach(() => {
  states.length = 0;
});

describe("ProtectionSection", () => {
  it("names the feature in its description", () => {
    render(<ProtectionForm feature="Music" />);

    expect(
      screen.getByRole("heading", { name: "Protection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set limits and word filters to prevent chat from abusing the Music system.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the cooldown in seconds and the max queue length", () => {
    render(<ProtectionForm />);

    expect(screen.getByText("(seconds)")).toBeInTheDocument();
    expect(field("Cooldown")).toHaveValue(2);
    expect(field("Max Queue Length")).toHaveValue(10);
  });

  it("saves the limits as numbers", async () => {
    const user = userEvent.setup();
    render(<ProtectionForm />);

    await user.clear(field("Cooldown"));
    await user.type(field("Cooldown"), "5");
    await user.clear(field("Max Queue Length"));
    await user.type(field("Max Queue Length"), "25");

    expect(current()).toEqual({ cooldown: 5, queue_length: 25 });
  });

  it("puts its children after the shared fields", () => {
    render(
      <ProtectionForm>
        <input placeholder="Banned words" />
      </ProtectionForm>,
    );

    expect(
      field("Max Queue Length").compareDocumentPosition(
        screen.getByPlaceholderText("Banned words"),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
