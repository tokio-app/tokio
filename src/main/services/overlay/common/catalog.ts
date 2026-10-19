import { CatalogOverlay, CatalogOverlaySchema } from "@/common/schemas";
import { isInside } from "@/helper/path";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

// The official overlays, published with every release of tokio-app/overlays.
// The format is in that repo's README.
export const CATALOG_URL =
  "https://github.com/tokio-app/overlays/releases/latest/download/overlays.json";
// Zips and previews only come from that repo's releases.
export const RELEASES_PREFIX =
  "https://github.com/tokio-app/overlays/releases/download/";

// Overlays weigh a few KB, this only stops a wrong catalog.
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const CATALOG_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

// The format this version of Tokio reads. Fields can be added to it; renaming
// or removing one makes a new schema.
const CatalogSchema = z.object({
  schema: z.literal(1),
  overlays: z.array(z.unknown()),
});

export interface Catalog {
  overlays: CatalogOverlay[];
  // Entries that couldn't be read, by id or position
  dropped: string[];
}

/** Reads the latest catalog. Throws when it can't be fetched or read. */
export async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(CATALOG_URL, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub responded with status: ${res.status}`);
  return parseCatalog(await res.json());
}

/**
 * The catalog's overlays. Entries that don't parse, or whose zip isn't in the
 * overlays repo's releases, are dropped. Previews from anywhere else are too.
 */
export function parseCatalog(data: unknown): Catalog {
  const catalog = CatalogSchema.safeParse(data);
  if (!catalog.success) throw new Error("It isn't a schema 1 catalog.");

  const overlays: CatalogOverlay[] = [];
  const dropped: string[] = [];
  catalog.data.overlays.forEach((value, i) => {
    const entry = CatalogOverlaySchema.safeParse(value);
    if (!entry.success || !isReleaseURL(entry.data.url)) {
      dropped.push(entryName(value, i));
      return;
    }
    const { preview } = entry.data;
    overlays.push({
      ...entry.data,
      preview: preview && isReleaseURL(preview) ? preview : null,
    });
  });
  return { overlays, dropped };
}

/**
 * Downloads an overlay's zip and checks its size and SHA-256 against the
 * catalog. Throws when it can't be downloaded or doesn't match.
 */
export async function downloadOverlay(
  overlay: CatalogOverlay,
): Promise<Uint8Array> {
  if (!isReleaseURL(overlay.url)) {
    throw new Error(`Refusing to download ${overlay.url}, it isn't a release.`);
  }
  if (overlay.size > MAX_ZIP_BYTES) {
    throw new Error(`Refusing to download ${overlay.url}, it's too big.`);
  }

  const res = await fetch(overlay.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub responded with status: ${res.status}`);

  const data = new Uint8Array(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (
    data.byteLength !== overlay.size ||
    sha256 !== overlay.sha256.toLowerCase()
  ) {
    throw new Error(`The download of ${overlay.id} doesn't match the catalog.`);
  }
  return data;
}

/**
 * Writes a zip's files into `folder`. Throws before writing anything when an
 * entry would land outside it.
 */
export async function extractZip(
  data: Uint8Array,
  folder: string,
): Promise<void> {
  // Folders are made along with their files.
  const files = Object.entries(unzipSync(data)).filter(
    ([name]) => !name.endsWith("/"),
  );
  for (const [name] of files) {
    if (name.includes("\\") || !isInside(folder, resolve(folder, name))) {
      throw new Error(`The zip has a file outside its folder: ${name}`);
    }
  }

  await mkdir(folder, { recursive: true });
  for (const [name, content] of files) {
    const file = resolve(folder, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

// Whether a URL points at a file of the overlays repo's releases. Parsed, so
// dot segments can't leave it.
function isReleaseURL(url: string): boolean {
  return URL.canParse(url) && new URL(url).href.startsWith(RELEASES_PREFIX);
}

function entryName(value: unknown, index: number): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }
  return `#${index + 1}`;
}
