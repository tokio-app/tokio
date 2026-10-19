import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENTS, SERVICES } from "./helper";

// AGENTS.md asks to keep the notices in sync with the code. These checks
// fail when they drift, so the notices get updated with the change.

// Vitest runs from the repository root
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");
const notices = read("THIRD_PARTY_NOTICES.md");

// A section of the notices, up to the next heading of its level or above
function section(heading: string) {
  const start = notices.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`No "${heading}" in the notices.`);
  const level = heading.split(" ")[0];
  const next = notices
    .slice(start + heading.length + 2)
    .search(new RegExp(`\\n#{1,${level.length}} `));
  return next === -1
    ? notices.slice(start)
    : notices.slice(start, start + heading.length + 2 + next);
}

const sourceFiles = () =>
  globSync("src/**/*.{ts,tsx}", { cwd: root }).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  );

describe("THIRD_PARTY_NOTICES.md", () => {
  it("lists every react-icons set the app uses", () => {
    const icons = section("## Icons");
    const sets = new Set(
      sourceFiles().flatMap((file) =>
        [...read(file).matchAll(/from "react-icons\/(\w+)"/g)].map(
          ([, set]) => set,
        ),
      ),
    );

    expect(sets.size).toBeGreaterThan(0);
    for (const set of sets) expect(icons).toContain(`(\`${set}\`)`);
  });

  it("names the same icon sets as About", () => {
    const rows = section("## Icons")
      .split("\n")
      .filter((line) => line.includes("(`"));
    const names = rows.flatMap((row) =>
      [...row.matchAll(/(?:^\||,)\s*([^|,(]+?) \(`\w+`\)/g)].map(
        ([, name]) => name,
      ),
    );

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(COMPONENTS.some((c) => c.name.includes(name))).toBe(true);
    }
  });

  it("lists the same online services as About, in order", () => {
    const listed = [...section("## Services").matchAll(/^- \*\*(.+?)\*\*/gm)];

    expect(listed.map(([, name]) => name.replace(/:$/, ""))).toEqual(
      SERVICES.map((s) => s.name),
    );
  });

  it("links license texts that exist, and every one of them", () => {
    const linked = new Set(
      [...notices.matchAll(/\(LICENSES\/([\w.-]+)\)/g)].map(([, file]) => file),
    );
    const shipped = readdirSync(join(root, "LICENSES"));

    expect([...linked].sort()).toEqual([...shipped].sort());
    for (const { doc } of COMPONENTS) {
      if (doc) expect(shipped).toContain(`${doc}.txt`);
    }
  });

  it("names the installed versions of the AGPL dependencies", () => {
    for (const name of ["tiktok-live-connector", "tiktok-live-proto"]) {
      const row = section(`### ${name}`).match(/\*\*Version\*\* \| (\S+)/);
      const pkg = JSON.parse(read(join("node_modules", name, "package.json")));

      // A new version can come with a new license, check it before updating
      expect(row?.[1], name).toBe(pkg.version);
    }
  });
});

describe("licenses in the code", () => {
  const LGPL = /SPDX-License-Identifier: LGPL|@license LGPL/;
  const DRM_V2 = "src/main/services/tts/providers/edge/common/drm-v2.ts";

  it("keeps the LGPL code in its own file, with its header", () => {
    const files = sourceFiles().map((file) => file.replaceAll("\\", "/"));

    expect(read(DRM_V2).split("\n")[0]).toBe(
      "// SPDX-License-Identifier: LGPL-3.0-only",
    );
    expect(files.filter((file) => LGPL.test(read(file)))).toEqual([DRM_V2]);
    expect(existsSync(join(root, "LICENSES", "LGPL-3.0.txt"))).toBe(true);
  });

  it("names the LGPL and AGPL parts in the bundle's banner", () => {
    const banner = read("electron.vite.config.ts");

    expect(banner).toContain("drm-v2.ts");
    expect(banner).toContain("LGPL-3.0-only");
    expect(banner).toContain(
      "tiktok-live-connector and tiktok-live-proto (AGPL-3.0-only)",
    );
  });

  it("keeps the repository's own code MIT", () => {
    expect(JSON.parse(read("package.json")).license).toBe("MIT");
  });
});
