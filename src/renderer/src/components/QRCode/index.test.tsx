import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QRCode } from ".";

const pathOf = (value: string) => {
  const { unmount } = render(<QRCode value={value} label="Remote link" />);
  const d = screen
    .getByRole("img", { name: "Remote link" })
    .querySelector("path")!
    .getAttribute("d")!;
  unmount();
  return d;
};

describe("QRCode", () => {
  it("draws the same squares for the same text", () => {
    const link = "http://192.168.1.20:37891/remote/#key=abc";
    const d = pathOf(link);

    // The top-left finder starts inside the 2-module border
    expect(d.startsWith("M2 2h1v1h-1z")).toBe(true);
    expect(pathOf(link)).toBe(d);
    expect(pathOf("http://192.168.1.21:37891/remote/#key=abc")).not.toBe(d);
  });
});
