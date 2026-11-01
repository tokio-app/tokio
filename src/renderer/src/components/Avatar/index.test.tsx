import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from ".";

const img = (container: HTMLElement) => container.querySelector("img");

describe("Avatar", () => {
  it("shows the picture", () => {
    const { container } = render(
      <Avatar name="sora" picture="https://p16.tiktokcdn.com/sora.webp" />,
    );

    expect(img(container)).toHaveAttribute(
      "src",
      "https://p16.tiktokcdn.com/sora.webp",
    );
  });

  it("shows the initial without a picture", () => {
    const { container } = render(<Avatar name="sora" picture="" />);

    expect(img(container)).toBeNull();
    expect(screen.getByText("S")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the initial once the picture fails, as an expired link does", () => {
    const { container } = render(
      <Avatar name="🌸sora" picture="https://p16.tiktokcdn.com/old.webp" />,
    );

    fireEvent.error(img(container)!);

    expect(img(container)).toBeNull();
    expect(screen.getByText("🌸")).toBeInTheDocument();
  });

  it("tries a new picture after one failed", () => {
    const { container, rerender } = render(
      <Avatar name="sora" picture="https://p16.tiktokcdn.com/old.webp" />,
    );
    fireEvent.error(img(container)!);

    rerender(
      <Avatar name="sora" picture="https://p16.tiktokcdn.com/new.webp" />,
    );

    expect(img(container)).toHaveAttribute(
      "src",
      "https://p16.tiktokcdn.com/new.webp",
    );
  });
});
