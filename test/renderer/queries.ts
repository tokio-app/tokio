import { screen, within } from "@testing-library/react";

/**
 * An item of a list portaled to the body, like a Select's options: the
 * element with the text that isn't inside `container`, or null.
 */
export const inList = (container: HTMLElement, text: string) =>
  screen.queryAllByText(text).find((el) => !container.contains(el)) ?? null;

/** Queries inside the section with this heading. */
export const section = (title: string) =>
  within(screen.getByRole("heading", { name: title }).closest("section")!);
