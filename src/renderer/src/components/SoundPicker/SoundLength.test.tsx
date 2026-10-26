import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      "tokio-media:///sounds/horn%20file.mp3",
    );
    expect(container).toHaveTextContent("");

    measure(container, 2.46);

    expect(screen.getByText("2.5s")).toBeInTheDocument();
  });

  it("shows a known length without reading the file", () => {
    const { container } = render(<SoundLength file="horn.mp3" seconds={65} />);
    expect(container.querySelector("audio")).toBeNull();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("shows the cut's part of the file's length, whole when the cut doesn't fit", () => {
    const cut = (start: number, end: number | null) => {
      const { container } = render(
        <SoundLength file="horn.mp3" cut={{ start, end }} />,
      );
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
    measure(container, seconds);
    expect(container).toHaveTextContent("");
  });

  it("shows nothing without a file or a length", () => {
    const { container } = render(<SoundLength />);
    expect(container).toBeEmptyDOMElement();
  });
});
