import { runEntry } from "@test/entry";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("music window entry", () => {
  it("mounts the title bar in #root", async () => {
    const root = await runEntry(() => import("./main"));

    expect(
      within(root).getByRole("button", { name: "Minimize" }),
    ).toBeInTheDocument();
  });
});
