import { LicenseDocument, LicenseText, PackageLicense } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Service } from "../shared";

export interface LicensesResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}

// Shipped by electron-builder.yml (extraResources), same layout as the repo.
const DOCUMENTS: (LicenseDocument & { file: string })[] = [
  { id: "tokio", title: "Tokio (MIT License)", file: "LICENSE" },
  {
    id: "notices",
    title: "Third-party notices",
    file: "THIRD_PARTY_NOTICES.md",
  },
  {
    id: "LGPL-3.0",
    title: "GNU Lesser General Public License v3.0",
    file: "LICENSES/LGPL-3.0.txt",
  },
  {
    id: "GPL-3.0",
    title: "GNU General Public License v3.0",
    file: "LICENSES/GPL-3.0.txt",
  },
  {
    id: "Apache-2.0",
    title: "Apache License 2.0",
    file: "LICENSES/Apache-2.0.txt",
  },
  {
    id: "CC-BY-4.0",
    title: "Creative Commons Attribution 4.0",
    file: "LICENSES/CC-BY-4.0.txt",
  },
];

const PACKAGE_NAME = /^(@[\w.-]+\/)?[\w.-]+$/;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|EUPL|CDDL|CC-BY-SA)/i;

type Manifest = Record<string, unknown>;
type PackageEntry = PackageLicense & { dir: string; files: string[] };

export class LicensesService extends Service {
  private _appDir = "";
  private _licensesDir = "";
  private _scan?: Promise<Map<string, PackageEntry>>;

  /**
   * `appDir` holds the app's package.json and node_modules (app.asar when
   * packaged), `licensesDir` the files listed in DOCUMENTS.
   */
  public initialize(appDir: string, licensesDir: string) {
    this._appDir = resolve(appDir);
    this._licensesDir = resolve(licensesDir);
    this._scan = undefined;
  }

  public getDocuments(): LicenseDocument[] {
    return DOCUMENTS.map(({ id, title }) => ({ id, title }));
  }

  /** Production dependencies, copyleft first. Scanned once. */
  public async getPackages(): Promise<LicensesResult<PackageLicense[]>> {
    try {
      const packages = await this.scan();
      const data = [...packages.values()]
        .map(({ dir: _dir, files: _files, ...pkg }) => pkg)
        .sort(
          (a, b) =>
            Number(b.copyleft) - Number(a.copyleft) ||
            a.name.localeCompare(b.name) ||
            a.version.localeCompare(b.version, undefined, { numeric: true }),
        );
      return { success: true, data };
    } catch (error) {
      this._scan = undefined;
      Logger.error(
        `<Licenses> Unable to read the installed packages -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      return { success: false, error: formatError(error) };
    }
  }

  /** Text of a document or a package's license and notice files, by id. */
  public async getText(id: string): Promise<LicensesResult<LicenseText>> {
    try {
      const doc = DOCUMENTS.find((d) => d.id === id);
      if (doc) {
        const text = await readFile(join(this._licensesDir, doc.file), "utf8");
        const markdown = doc.file.endsWith(".md");
        return {
          success: true,
          data: { id, title: doc.title, text, markdown },
        };
      }

      const pkg = (await this.scan()).get(id);
      if (!pkg) throw new Error(`Unknown license id "${id}".`);

      const title = `${pkg.name} ${pkg.version} (${pkg.license})`;
      if (pkg.files.length === 0) {
        const text = `This package doesn't include a license file. Its package.json declares the license: ${pkg.license}.`;
        return { success: true, data: { id, title, text } };
      }

      const texts: string[] = [];
      for (const file of pkg.files) {
        try {
          const text = await readFile(join(pkg.dir, file), "utf8");
          texts.push(
            pkg.files.length > 1
              ? `${file}\n${"=".repeat(file.length)}\n\n${text.trim()}`
              : text,
          );
        } catch {
          // A folder or an unreadable file, the others are still shown
        }
      }
      if (texts.length === 0) {
        throw new Error(`No license file of ${id} could be read.`);
      }
      return { success: true, data: { id, title, text: texts.join("\n\n\n") } };
    } catch (error) {
      Logger.error(
        `<Licenses> Unable to read the license ${id} -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      return { success: false, error: formatError(error) };
    }
  }

  private scan() {
    this._scan ??= this.walk();
    return this._scan;
  }

  // Follows the dependency tree from the app's package.json, resolving each
  // name like Node does, so devDependencies are never listed.
  private async walk(): Promise<Map<string, PackageEntry>> {
    const root = await readManifest(this._appDir);
    const packages = new Map<string, PackageEntry>();
    const visited = new Set<string>();
    const queue = dependencyNames(root).map((name) => ({
      name,
      from: this._appDir,
    }));

    for (let next = queue.shift(); next; next = queue.shift()) {
      const dir = this.resolvePackage(next.name, next.from);
      if (!dir || visited.has(dir)) continue;
      visited.add(dir);

      let manifest: Manifest;
      try {
        manifest = await readManifest(dir);
      } catch (error) {
        Logger.warn(
          `<Licenses> Skipped ${next.name} -- ${formatError(error)}`,
          this._logFile,
        );
        continue;
      }

      const entry = await toEntry(dir, manifest);
      if (!packages.has(entry.id)) packages.set(entry.id, entry);

      for (const name of dependencyNames(manifest)) {
        queue.push({ name, from: dir });
      }
    }

    return packages;
  }

  // Looks in node_modules from `from` up to the app folder.
  private resolvePackage(name: string, from: string): string | null {
    if (!PACKAGE_NAME.test(name)) return null;

    for (let dir = from; ; dir = dirname(dir)) {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return candidate;
      if (dir === this._appDir || dirname(dir) === dir) return null;
    }
  }
}

async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
}

// Optional dependencies are only listed when they're installed. Peers are
// skipped: in dev they resolve to devDependencies such as electron, and the
// ones shipped are a regular dependency of another package.
function dependencyNames(manifest: Manifest): string[] {
  const names = new Set<string>();
  for (const key of ["dependencies", "optionalDependencies"]) {
    const deps = manifest[key];
    if (deps && typeof deps === "object") {
      for (const name of Object.keys(deps)) names.add(name);
    }
  }
  return [...names];
}

async function toEntry(dir: string, manifest: Manifest): Promise<PackageEntry> {
  const name = typeof manifest.name === "string" ? manifest.name : dir;
  const version =
    typeof manifest.version === "string" ? manifest.version : "0.0.0";
  const license = licenseOf(manifest);

  let files: string[] = [];
  try {
    files = (await readdir(dir))
      .filter((file) => LICENSE_FILE.test(file))
      // License files before notices
      .sort(
        (a, b) =>
          Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) ||
          a.localeCompare(b),
      );
  } catch {
    // Listed without a license text
  }

  return {
    id: `${name}@${version}`,
    name,
    version,
    license,
    author: authorOf(manifest.author),
    url: urlOf(manifest),
    copyleft: COPYLEFT.test(license),
    dir,
    files,
  };
}

function licenseOf(manifest: Manifest): string {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license) return license;
  if (license && typeof license === "object" && "type" in license) {
    return String(license.type);
  }
  // Legacy `licenses: [{ type, url }]`
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((l) => (typeof l === "string" ? l : l?.type))
      .filter(Boolean);
    if (types.length) return types.join(" OR ");
  }
  return "UNKNOWN";
}

function authorOf(author: unknown): string | undefined {
  if (typeof author === "string") {
    // "Name <email> (url)"
    return author.split(/[<(]/)[0].trim() || undefined;
  }
  if (author && typeof author === "object" && "name" in author) {
    return String(author.name) || undefined;
  }
  return undefined;
}

// Opened with shell.openExternal, so only http(s) URLs are returned.
function urlOf(manifest: Manifest): string | undefined {
  const { repository, homepage } = manifest;
  const raw =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object" && "url" in repository
        ? String(repository.url)
        : undefined;

  if (raw) {
    let url = raw
      .trim()
      .replace(/^git\+/, "")
      .replace(/\.git$/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@/, "https://")
      .replace(/^git@([^:/]+):/, "https://$1/");

    const short = url.match(/^(github|gitlab|bitbucket):(.+)$/);
    if (short) {
      const host =
        short[1] === "bitbucket" ? "bitbucket.org" : `${short[1]}.com`;
      url = `https://${host}/${short[2]}`;
    } else if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
      url = `https://github.com/${url}`;
    }

    if (/^https?:\/\//.test(url)) return url;
  }

  if (typeof homepage === "string" && /^https?:\/\//.test(homepage)) {
    return homepage;
  }
  return undefined;
}
