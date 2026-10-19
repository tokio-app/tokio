import { runEntry } from "@test/entry";
import { within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./App", () => ({ default: () => <p>The app</p> }));

describe("main window entry", () => {
  it("mounts the app in #root", async () => {
    const root = await runEntry(() => import("./main"));

    expect(within(root).getByText("The app")).toBeInTheDocument();
  });
});
