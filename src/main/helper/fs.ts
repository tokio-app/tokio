import { rename, rm, writeFile } from "node:fs/promises";
import { track } from "./quit";

// Windows antivirus and indexers hold a file they just saw for a moment.
const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);
const isBusy = (error: unknown) =>
  error instanceof Error && "code" in error && BUSY.has(String(error.code));
// About a second in all
const RETRY_DELAYS_MS = [50, 100, 200, 300, 350];

/**
 * Renames `from` to `to`, trying again for about a second while the file is
 * held by another program. Any other error throws at once.
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (!isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return rename(from, to);
}

/**
 * Writes the file whole or not at all: a crash or full disk midway leaves the
 * old file as it was, and a quit waits for it.
 */
export function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  return track(write(path, data));
}

async function write(path: string, data: string | Uint8Array) {
  const temp = `${path}.tmp`;
  try {
    await writeFile(temp, data);
    await renameWithRetry(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
