import { OverlayConfig } from "@/common/schemas";
import { OverlayConfigRedux, TokioPreviewMessage } from "@/common/types";
import { gift, overlayApp, overlayConfig } from "@test/fixtures";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { OverlayModal } from ".";

const GIFTS = [gift(5655, "Rose"), gift(6064, "GG")];

type Props = ComponentProps<typeof OverlayModal>;

function setup(props: Partial<Props> = {}) {
  const all: Props = {
    overlay: overlayApp("gift-jar", { name: "Gift Jar" }),
    config: overlayConfig(),
    gifts: GIFTS,
    saving: false,
    onRequestClose: vi.fn(),
    onSave: vi.fn(),
    onTest: vi.fn(),
    ...props,
  };
  const view = render(<OverlayModal {...all} />);
  const rerender = (patch: Partial<Props>) =>
    view.rerender(<OverlayModal {...all} {...patch} />);
  return { ...view, ...all, rerender, user: userEvent.setup() };
}

// overlayConfig() with every field changed from its default
function edited(): OverlayConfig {
  const config = overlayConfig();
  const [title, size, show] = config.fields;
  Object.assign(title.attributes, { value: "Raised" });
  Object.assign(size.attributes, { value: 80 });
  Object.assign(show.attributes, { value: false });
  return config;
}

// A config with one changed value, the way the modal edits it
function withValue(config: OverlayConfig, id: string, value: unknown) {
  const changed = structuredClone(config);
  const field = changed.fields.find((f) => f.id === id)!;
  Object.assign(field.attributes, { value });
  return changed;
}

const button = (name: string) => screen.getByRole("button", { name });
const title = () => screen.getByPlaceholderText("Type a title");
const size = () => screen.getByRole("slider");
const show = () => screen.getByRole("checkbox", { name: "Show count" });

// The field's own reset button, beside its name
const resetOf = (name: string) =>
  within(screen.getByText(name).parentElement!).getByRole("button", {
    name: "Reset to default",
  });

function preview() {
  const iframe = screen.getByTitle<HTMLIFrameElement>("Viewer for gift-jar");
  return { iframe, post: vi.spyOn(iframe.contentWindow!, "postMessage") };
}

const configMessage = (data: OverlayConfigRedux): TokioPreviewMessage => ({
  action: "TOKIO_PREVIEW",
  payload: { type: "tokio:config", data },
});

describe("OverlayModal", () => {
  it("shows a loader until the config arrives", () => {
    const { rerender } = setup({ config: null });

    expect(
      screen.getByRole("heading", { name: "Gift Jar" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(button("Reset to defaults")).toBeDisabled();
    expect(button("Save")).toBeDisabled();

    rerender({ config: overlayConfig() });

    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(title()).toHaveValue("Goal");
  });

  it("groups the fields by section", () => {
    const config = overlayConfig();
    config.sections.push({ id: "empty", name: "Empty" });
    setup({ config });

    const general = within(screen.getByRole("group", { name: "General" }));
    expect(general.getByText("Title")).toBeInTheDocument();
    expect(general.getByPlaceholderText("Type a title")).toHaveValue("Goal");

    const style = within(screen.getByRole("group", { name: "Style" }));
    expect(style.getByRole("slider")).toHaveValue("50");
    expect(style.getByRole("checkbox", { name: "Show count" })).toBeChecked();

    // A section without fields isn't shown
    expect(
      screen.queryByRole("group", { name: "Empty" }),
    ).not.toBeInTheDocument();
  });

  it("saves the edited config, once something changed", async () => {
    const { user, onSave } = setup();
    expect(button("Save")).toBeDisabled();

    await user.type(title(), "!");
    fireEvent.change(size(), { target: { value: "70" } });
    await user.click(show());
    expect(button("Save")).toBeEnabled();

    await user.click(button("Save"));

    let expected = withValue(overlayConfig(), "title", "Goal!");
    expected = withValue(expected, "size", 70);
    expected = withValue(expected, "show", false);
    expect(onSave).toHaveBeenCalledWith(expected);
  });

  it("can't save after a change is undone", async () => {
    const { user } = setup();

    await user.click(show());
    await user.click(show());

    expect(button("Save")).toBeDisabled();
  });

  it("loads while saving", () => {
    const { rerender } = setup();
    const save = button("Save");
    expect(save).not.toHaveAttribute("aria-busy");

    rerender({ saving: true });

    expect(save).toHaveAttribute("aria-busy", "true");
  });

  it("resets every field to its default", async () => {
    const config = edited();
    const { user, onSave } = setup({ config });
    expect(title()).toHaveValue("Raised");
    expect(button("Save")).toBeDisabled();

    await user.click(button("Reset to defaults"));

    expect(title()).toHaveValue("Goal");
    expect(size()).toHaveValue("50");
    expect(show()).toBeChecked();
    expect(button("Reset to defaults")).toBeDisabled();

    await user.click(button("Save"));
    expect(onSave).toHaveBeenCalledWith(overlayConfig());
  });

  it("can't reset a config that's at its defaults", () => {
    setup();

    expect(button("Reset to defaults")).toBeDisabled();
  });

  it("resets one field to its default", async () => {
    const { user } = setup({ config: edited() });
    expect(resetOf("Title")).toBeEnabled();
    expect(resetOf("Size")).toBeEnabled();

    await user.click(resetOf("Title"));

    expect(title()).toHaveValue("Goal");
    expect(resetOf("Title")).toBeDisabled();
    expect(size()).toHaveValue("80");
  });

  it("offers a field's reset only once it differs from its default", async () => {
    const { user } = setup();
    expect(resetOf("Title")).toBeDisabled();

    await user.type(title(), "!");

    expect(resetOf("Title")).toBeEnabled();
    expect(resetOf("Size")).toBeDisabled();
  });

  it("tests the overlay", async () => {
    const { user, onTest } = setup();

    await user.click(button("Test"));

    expect(onTest).toHaveBeenCalledOnce();
  });

  it("closes with Cancel or the close button", async () => {
    const { user, onRequestClose, onSave } = setup();

    await user.click(button("Cancel"));
    await user.click(button("Close"));

    expect(onRequestClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the overlay in its own preview", () => {
    setup();

    expect(screen.getByTitle("Viewer for gift-jar")).toHaveAttribute(
      "name",
      "TOKIO_APP-gift-jar",
    );
  });

  it("sends the unsaved settings to its preview once it loads", async () => {
    const { user } = setup();
    const { iframe, post } = preview();

    fireEvent.load(iframe);
    expect(post).toHaveBeenLastCalledWith(
      configMessage({ title: "Goal", size: 50, show: true }),
      "*",
    );

    await user.type(title(), "!");
    expect(post).toHaveBeenLastCalledWith(
      configMessage({ title: "Goal!", size: 50, show: true }),
      "*",
    );
  });

  it("sends nothing before its preview loads", async () => {
    const { user } = setup();
    const { post } = preview();

    await user.type(title(), "!");

    expect(post).not.toHaveBeenCalled();
  });

  it("sends the config to its preview when it arrives after the load", () => {
    const { rerender } = setup({ config: null });
    const { iframe, post } = preview();
    fireEvent.load(iframe);
    expect(post).not.toHaveBeenCalled();

    rerender({ config: overlayConfig() });

    expect(post).toHaveBeenCalledWith(
      configMessage({ title: "Goal", size: 50, show: true }),
      "*",
    );
  });

  it("sends its preview colors with their # and the gifts they name", () => {
    const config = overlayConfig();
    config.fields.push(
      {
        id: "color",
        name: "Color",
        section: "style",
        type: "color",
        attributes: { value: "ff0000", default: "ff0000" },
      },
      {
        id: "gift",
        name: "Gift",
        section: "general",
        type: "gifts",
        attributes: { multiple: false, value: 6064, default: 6064 },
      },
    );
    setup({ config });
    const { iframe, post } = preview();

    fireEvent.load(iframe);

    expect(post).toHaveBeenCalledWith(
      configMessage({
        title: "Goal",
        size: 50,
        show: true,
        color: "#ff0000",
        gift: GIFTS[1],
      }),
      "*",
    );
  });
});
