import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Whether `file` is inside `folder`. The folder itself isn't, and neither is
 * anything on another drive on Windows.
 */
export function isInside(folder: string, file: string): boolean {
  const inside = relative(resolve(folder), resolve(file));
  return (
    inside !== "" &&
    inside !== ".." &&
    !inside.startsWith(`..${sep}`) &&
    !isAbsolute(inside)
  );
}
