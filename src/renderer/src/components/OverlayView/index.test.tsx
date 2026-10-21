import { OverlayApp } from "@/common/types";
import { getOverlayURL } from "@/common/util";
import { overlayApp } from "@test/fixtures";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactElement } from "react";
import { FaRegCopy } from "react-icons/fa";
import { FiCheck } from "react-icons/fi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayView } from ".";

function setup(overlay: OverlayApp = overlayApp("gift-jar")) {
  const onTest = vi.fn();
  const onCustomize = vi.fn();
  const view = render(
    <OverlayView overlay={overlay} onTest={onTest} onCustomize={onCustomize} />,
  );
  const user = userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
  });
  return { ...view, onTest, onCustomize, user };
}

// What an icon draws, to tell which one a button shows
function drawing(icon: ReactElement) {
  const { container, unmount } = render(icon);
  const paths = container.querySelector("svg")!.innerHTML;
  unmount();
  return paths;
}

const copyButton = () => screen.getByTitle("Copy URL");
const shownIcon = () => copyButton().querySelector("svg")!.innerHTML;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverlayView", () => {
  it("shows the overlay's name and version", () => {
    setup(overlayApp("gift-jar", { name: "Gift Jar", version: "2.1.0" }));

    expect(
      screen.getByRole("heading", { name: "Gift Jar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2.1.0")).toBeInTheDocument();
  });

  it("marks official overlays verified, and imported ones external", () => {
    const { unmount } = setup(overlayApp("gift-jar", { external: false }));
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByText("External")).not.toBeInTheDocument();
    unmount();

    setup(overlayApp("imported", { external: true }));
    expect(screen.getByText("External")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("tests the overlay", async () => {
    const { user, onTest } = setup();

    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(onTest).toHaveBeenCalledWith("gift-jar");
  });

  it("customizes an overlay that has settings", async () => {
    const { user, onCustomize } = setup();

    await user.click(screen.getByRole("button", { name: "Customize" }));

    expect(onCustomize).toHaveBeenCalledWith("gift-jar");
  });

  it("can't customize an overlay without settings", () => {
    setup(overlayApp("clock", { config: false }));

    expect(
      screen.queryByRole("button", { name: "Customize" }),
    ).not.toBeInTheDocument();
  });

  it("shows the overlay's URL", () => {
    setup();

    expect(copyButton()).toHaveTextContent(getOverlayURL("gift-jar"));
  });

  it("copies the URL and shows a check for a moment", async () => {
    const { user } = setup();
    // readText waits on jsdom's FileReader, which the fake timers hold
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const copyIcon = drawing(<FaRegCopy />);
    const checkIcon = drawing(<FiCheck />);
    expect(shownIcon()).toBe(copyIcon);

    await user.click(copyButton());

    expect(writeText).toHaveBeenCalledWith(getOverlayURL("gift-jar"));
    expect(shownIcon()).toBe(checkIcon);

    act(() => vi.advanceTimersByTime(1499));
    expect(shownIcon()).toBe(checkIcon);

    act(() => vi.advanceTimersByTime(1));
    expect(shownIcon()).toBe(copyIcon);
  });

  it("previews the overlay in a frame named after it", () => {
    setup();

    const frame = screen.getByTitle("Viewer for gift-jar");
    expect(frame).toHaveAttribute("name", "TOKIO_APP-gift-jar");
    expect(frame.getAttribute("src")).toMatch(/^local-resource:\/\//);
  });

  it("shows the overlay full size, with its own frame and test", async () => {
    const { user, onTest } = setup(
      overlayApp("gift-jar", { name: "Gift Jar" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Full size" }));

    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByRole("heading", { name: "Gift Jar" }),
    ).toBeInTheDocument();
    // Both previews get the overlay's messages
    expect(dialog.getByTitle("Viewer for gift-jar")).toHaveAttribute(
      "name",
      "TOKIO_APP-gift-jar",
    );
    expect(screen.getAllByTitle("Viewer for gift-jar")).toHaveLength(2);

    await user.click(dialog.getByRole("button", { name: "Test" }));
    expect(onTest).toHaveBeenCalledWith("gift-jar");

    await user.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
