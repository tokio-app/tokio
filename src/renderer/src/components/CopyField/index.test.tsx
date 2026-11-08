import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyField } from ".";
import styles from "./copyfield.module.css";

describe("CopyField", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the check for 1.5s after the last copy", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<CopyField value="http://localhost:37891/" title="Copy link" />);
    const field = screen.getByTitle("Copy link");
    const checked = () => field.querySelector(`.${styles.copied}`) !== null;
    const wait = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    expect(checked()).toBe(false);
    await user.click(field);
    expect(write).toHaveBeenLastCalledWith("http://localhost:37891/");
    expect(checked()).toBe(true);

    await wait(1000);
    await user.click(field);
    await wait(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(checked()).toBe(true);

    await wait(500);
    expect(checked()).toBe(false);
  });
});
