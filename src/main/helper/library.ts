import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { writeFileAtomic } from "./fs";

// The libraries' file names: a sound's, a picture's, a TTS message's key
export const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex").slice(0, 32);

export async function isSaved(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a file into a library's folder, named by its content, so importing
 * the same file twice reuses it. Throws for another extension or a bigger
 * file. The entry is named after the file.
 */
export async function importFile(
  srcPath: string,
  folder: string,
  extensions: string[],
  maxBytes: number,
) {
  const ext = extname(srcPath).slice(1).toLowerCase();
  if (!extensions.includes(ext)) {
    throw new Error(`Unsupported format: ${ext}`);
  }
  if ((await stat(srcPath)).size > maxBytes) {
    throw new Error(`The file is over ${maxBytes} bytes.`);
  }
  const data = new Uint8Array(await readFile(srcPath));
  const file = `${hash(data)}.${ext}`;
  // Whole or not at all: names are hashes, so a half-written file would pass
  // for the file forever
  if (!(await isSaved(join(folder, file)))) {
    await writeFileAtomic(join(folder, file), data);
  }
  return { data, entry: { name: basename(srcPath, extname(srcPath)), file } };
}
