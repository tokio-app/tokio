import type { MediaFile } from "@/common/schemas";
import type { ServiceResult } from "@/services/shared";
import type { AppHandlerVariables } from "@/types";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { LoggedError, saveFailure } from "./feedback";
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
  // A Buffer is a Uint8Array, a copy would double a big video in memory
  const data = await readFile(srcPath);
  const file = `${hash(data)}.${ext}`;
  // Whole or not at all: names are hashes, so a half-written file would pass
  // for the file forever
  if (!(await isSaved(join(folder, file)))) {
    await writeFileAtomic(join(folder, file), data);
  }
  return { data, entry: { name: basename(srcPath, extname(srcPath)), file } };
}

/**
 * Copies the files into a library, then lists them with one save. One bad
 * file doesn't stop the others, the service logs each failure (`error` is
 * the last one's). Throws when the library couldn't be saved.
 */
export async function upload(
  paths: string[],
  importFile: (path: string) => Promise<ServiceResult<MediaFile>>,
  library: {
    list: () => MediaFile[];
    add: (files: MediaFile[]) => Promise<boolean>;
  },
) {
  let failed = 0;
  let error: string | undefined;
  const imported: MediaFile[] = [];
  for (const path of paths) {
    const res = await importFile(path);
    if (res.data) imported.push(res.data);
    else {
      failed++;
      error = res.error;
    }
  }
  // Files are named by content: one in the library, or picked twice, isn't new.
  const known = new Set(library.list().map((f) => f.file));
  const added = imported.filter((f) => {
    const isNew = !known.has(f.file);
    known.add(f.file);
    return isNew;
  }).length;
  // shortcut: a quit in the middle of a big add saves none of it (the copied
  // files stay in the folder), save in chunks if that bites.
  // Added even with nothing new: a failed save may have left one out of the
  // store file.
  if (imported.length > 0 && !(await library.add(imported))) {
    throw saveFailure();
  }
  return { failed, added, imported, error };
}

/**
 * Adds every picture to the Minecraft pictures library, each once. One bad
 * file doesn't stop the others, the service logs each failure. Throws when
 * none could be imported. `saved` is false when the library wasn't written:
 * main holds them anyway.
 */
export async function importPictures(
  {
    gamesService,
    storeManagerService,
  }: Pick<AppHandlerVariables, "gamesService" | "storeManagerService">,
  paths: string[],
) {
  const pictures: MediaFile[] = [];
  let failed = 0;
  let error: string | undefined;
  for (const path of paths) {
    const { data, error: why } = await gamesService.importPicture(path);
    if (!data) {
      failed++;
      error = why;
    } else if (!pictures.some((p) => p.file === data.file)) {
      // Files are named by content: one picked twice is the same picture
      pictures.push(data);
    }
  }
  if (pictures.length === 0) throw new LoggedError(error);

  const saved = await storeManagerService.addMinecraftPictures(pictures);
  return { pictures, failed, saved };
}
