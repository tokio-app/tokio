import { intersect } from "@test/dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { SoundLength } from "./SoundLength";

// The hidden audio element read the file's length
const measure = (container: HTMLElement, seconds: number) => {
  const audio = container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { value: seconds });
  fireEvent.loadedMetadata(audio);
};

describe("SoundLength", () => {
  it("reads a library file's length", () => {
    const { container } = render(<SoundLength file="horn file.mp3" />);
    expect(container.querySelector("audio")).toBeNull();

    intersect();
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      "tokio-media:///sounds/horn%20file.mp3",
    );
    expect(container).toHaveTextContent("");

    measure(container, 2.46);

    expect(screen.getByText("2.5s")).toBeInTheDocument();
    // Read once, its player goes
    expect(container.querySelector("audio")).toBeNull();
  });

  it("shows nothing for a file that fails to load, and doesn't retry it", () => {
    const { container } = render(<SoundLength file="gone.mp3" />);
    intersect();
    fireEvent.error(container.querySelector("audio")!);

    expect(container).toHaveTextContent("");
    intersect();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("shows a known length without reading the file", () => {
    const { container } = render(<SoundLength file="horn.mp3" seconds={65} />);
    intersect();
    expect(container.querySelector("audio")).toBeNull();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("shows the cut's part of the file's length, whole when the cut doesn't fit", () => {
    const cut = (start: number, end: number | null) => {
      const { container } = render(
        <SoundLength file="horn.mp3" cut={{ start, end }} />,
      );
      intersect();
      measure(container, 10);
      return container.textContent;
    };

    expect(cut(2, 5)).toBe("3s");
    expect(cut(2, null)).toBe("8s");
    expect(cut(2, 30)).toBe("8s");
    expect(cut(12, 15)).toBe("10s");
  });

  it.each([NaN, Infinity, 0])("shows nothing for a length of %s", (seconds) => {
    const { container } = render(<SoundLength file="horn.mp3" />);
    intersect();
    measure(container, seconds);
    expect(container).toHaveTextContent("");
  });

  it("shows nothing without a file or a length", () => {
    const { container } = render(<SoundLength />);
    expect(container).toBeEmptyDOMElement();
  });

  it("frees its audio once it's removed", async () => {
    const { container, unmount } = render(<SoundLength file="horn.mp3" />);
    intersect();
    const audio = container.querySelector("audio")!;

    unmount();
    await Promise.resolve();

    expect(audio).not.toHaveAttribute("src");
  });

  it("keeps its audio through StrictMode's second mount", async () => {
    const { container } = render(
      <StrictMode>
        <SoundLength file="horn.mp3" />
      </StrictMode>,
    );
    intersect();
    await Promise.resolve();

    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      "tokio-media:///sounds/horn.mp3",
    );
  });
});
