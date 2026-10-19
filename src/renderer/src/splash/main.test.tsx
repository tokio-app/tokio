import { runEntry } from "@test/entry";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("splash entry", () => {
  it("mounts the splash screen in #root", async () => {
    const root = await runEntry(() => import("./main"));

    expect(within(root).getByText("Starting up...")).toBeInTheDocument();
  });
});
