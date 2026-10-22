import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Iframe } from ".";

const frame = () => screen.getByTitle("Viewer for gift-jar");
const src = () => frame().getAttribute("src");

describe("Iframe", () => {
  it("loads a Windows path through local-resource:", () => {
    render(
      <Iframe
        name="gift-jar"
        source="C:\Users\me\.tokio\overlays\gift-jar\index.html"
      />,
    );

    expect(src()).toBe(
      "local-resource:///C:/Users/me/.tokio/overlays/gift-jar/index.html",
    );
  });

  it("keeps a leading slash and encodes spaces", () => {
    render(
      <Iframe
        name="gift-jar"
        source="/home/my user/.tokio/overlays/gift-jar/index.html"
      />,
    );

    expect(src()).toBe(
      "local-resource:///home/my%20user/.tokio/overlays/gift-jar/index.html",
    );
  });

  // Windows allows # in user names
  it("keeps a # in folder names as part of the path", () => {
    render(
      <Iframe
        name="gift-jar"
        source="C:\Users\Me#1\.tokio\overlays\gift-jar\index.html"
      />,
    );

    const url = new URL(src()!);
    expect(decodeURIComponent(url.pathname)).toBe(
      "/C:/Users/Me#1/.tokio/overlays/gift-jar/index.html",
    );
  });

  it("keeps a ? in folder names as part of the path", () => {
    render(<Iframe name="gift-jar" source="/home/what?/overlays/index.html" />);

    const url = new URL(src()!);
    expect(url.search).toBe("");
    expect(decodeURIComponent(url.pathname)).toBe(
      "/home/what?/overlays/index.html",
    );
  });

  it("names the frame after the overlay, so previews can be posted to", () => {
    render(<Iframe name="gift-jar" source="C:\overlays\index.html" />);

    expect(frame()).toHaveAttribute("name", "TOKIO_APP-gift-jar");
  });

  it("stays hidden behind a loader until it loads", () => {
    const onLoad = vi.fn();
    render(
      <Iframe
        name="gift-jar"
        source="C:\overlays\index.html"
        onLoad={onLoad}
      />,
    );
    expect(frame()).not.toBeVisible();
    expect(screen.getByRole("status", { name: "Loading" })).toBeVisible();

    fireEvent.load(frame());

    expect(frame()).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("passes its ref to the frame", () => {
    const ref = createRef<HTMLIFrameElement>();
    render(
      <Iframe ref={ref} name="gift-jar" source="C:\overlays\index.html" />,
    );

    expect(ref.current).toBe(frame());
  });
});
