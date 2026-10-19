import { act } from "@testing-library/react";

/**
 * Runs a window's entry point (main.tsx) the way its index.html does, with a
 * #root to mount in, and returns that element.
 */
export async function runEntry(load: () => Promise<unknown>) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  await act(async () => {
    await load();
  });
  return root;
}
