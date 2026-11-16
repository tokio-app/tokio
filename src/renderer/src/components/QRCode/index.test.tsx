import Logo from "@/assets/logo.png";
import { render, screen } from "@testing-library/react";
import { encode, QrCodeDataType } from "uqr";
import { describe, expect, it } from "vitest";
import { QRCode } from ".";

const KEY = "Zx9-kQ_3vB7mN2pL8rT4wY6a";
// The shortest and the longest link an IPv4 address gives
const LINKS = [
  `http://1.1.1.1:37891/remote/#key=${KEY}`,
  `http://192.168.100.200:37891/remote/#key=${KEY}`,
];

const draw = (value: string) => {
  const { unmount } = render(<QRCode value={value} label="Remote link" />);
  const svg = screen.getByRole("img", { name: "Remote link" });
  const image = svg.querySelector("image")!;
  const [x, y, w, h] = ["x", "y", "width", "height"].map((name) =>
    Number(image.getAttribute(name)),
  );
  const drawn = {
    html: svg.outerHTML,
    size: Number(svg.getAttribute("viewBox")!.split(" ")[2]),
    logo: { x, y, w, h, href: image.getAttribute("href") },
    // Where each module starts, as its column and row
    modules: [
      ...svg
        .querySelector("path")!
        .getAttribute("d")!
        .matchAll(/M([\d.]+) ([\d.]+)/g),
    ].map(([, mx, my]) => [Math.floor(Number(mx)), Math.floor(Number(my))]),
  };
  unmount();
  return drawn;
};

describe("QRCode", () => {
  it("draws the same code for the same text", () => {
    const [, link] = LINKS;

    expect(draw(link).html).toBe(draw(link).html);
    expect(draw(link.replace(".200", ".201")).html).not.toBe(draw(link).html);
  });

  it.each(LINKS)(
    "leaves the middle to the logo, never over what cameras look for: %s",
    (link) => {
      const { size, logo, modules } = draw(link);
      const { data, types } = encode(link, { ecc: "Q", border: 2 });
      const under = (x: number, y: number) =>
        x + 1 > logo.x &&
        x < logo.x + logo.w &&
        y + 1 > logo.y &&
        y < logo.y + logo.h;

      expect(logo.href).toBe(Logo);
      expect(logo.x + logo.w / 2).toBe(size / 2);
      expect(logo.y + logo.h / 2).toBe(size / 2);
      // Every dark module but the eyes, drawn on their own, and the logo's
      expect(modules).toEqual(
        data.flatMap((row, y) =>
          row.flatMap((dark, x) =>
            dark && types[y][x] !== QrCodeDataType.Position && !under(x, y)
              ? [[x, y]]
              : [],
          ),
        ),
      );
      // The finders, timing, alignment and format modules stay whole
      expect(
        types.flatMap((row, y) =>
          row.filter(
            (type, x) => type >= QrCodeDataType.Function && under(x, y),
          ),
        ),
      ).toEqual([]);
    },
  );
});
