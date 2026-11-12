import { intersect } from "@test/dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNearView } from "./useNearView";

function Probe() {
  const [ref, near] = useNearView<HTMLSpanElement>();
  return <span ref={ref}>{near ? "near" : "far"}</span>;
}

describe("useNearView", () => {
  it("follows the element in and out of view", () => {
    render(<Probe />);
    expect(screen.getByText("far")).toBeInTheDocument();

    intersect();
    expect(screen.getByText("near")).toBeInTheDocument();

    intersect(false);
    expect(screen.getByText("far")).toBeInTheDocument();
  });
});
