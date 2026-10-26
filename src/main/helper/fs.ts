import { rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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

// The last write queued for each file: writes to one file share its temp file.
const writing = new Map<string, Promise<void>>();

/**
 * Writes the file whole or not at all: a crash or full disk midway leaves the
 * old file as it was, and a quit waits for it. Writes to one file run in the
 * order they came, so the last one wins.
 */
export function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  const key = resolve(path);
  const done = (writing.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => write(path, data));
  writing.set(key, done);
  const idle = () => {
    if (writing.get(key) === done) writing.delete(key);
  };
  done.then(idle, idle);
  return track(done);
}

async function write(path: string, data: string | Uint8Array) {
  const temp = `${path}.tmp`;
  try {
    // Without the flush, a power cut after the rename can leave a file of NULs.
    await writeFile(temp, data, { flush: true });
    await renameWithRetry(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
