import { DEFAULT_LANGUAGE, MESSAGES, type MessageKey } from "@/common/i18n";

// A page holds at least this many notes, unless the release has fewer
const MIN_NOTES = 3;

// Orders versions as semver does: 0.1.3-beta.2 < 0.1.3-beta.10 < 0.1.3 < 0.1.10
function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.split("-");
  const [coreB, preB] = b.split("-");
  const byNumbers = (x: string, y: string) =>
    x.localeCompare(y, "en", { numeric: true });

  const core = byNumbers(coreA, coreB);
  if (core !== 0) return core;
  // A release comes after its own prereleases
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return byNumbers(preA, preB);
}

/**
 * The key of the notes of version `to`, one change per line, after an update
 * to it from `from` ("" when that isn't known). Undefined when the release has
 * none, or after a downgrade.
 */
export function notesKey(
  from: string,
  to: string,
  texts: Record<string, string> = MESSAGES[DEFAULT_LANGUAGE],
): MessageKey | undefined {
  const key = `releases.${to}`;
  if (!Object.hasOwn(texts, key)) return undefined;
  if (from !== "" && compareVersions(to, from) <= 0) return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the texts have it
  return key as MessageKey;
}

/**
 * Splits notes into pages of at least `MIN_NOTES`, as even as they go: 7 notes
 * make pages of 4 and 3.
 */
export function pagesOf(notes: string[]): string[][] {
  const count = Math.max(1, Math.floor(notes.length / MIN_NOTES));
  const pages: string[][] = [];
  let start = 0;
  for (let left = count; left > 0; left--) {
    const size = Math.ceil((notes.length - start) / left);
    pages.push(notes.slice(start, start + size));
    start += size;
  }
  return pages;
}
