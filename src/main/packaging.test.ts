import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// electron-builder.yml strips the code of the packages only the windows load,
// so main reaching one would pass every check and break the installed app.

const root = process.cwd();

// The packages in the `!node_modules/{…}` entry of `files`
function strippedPackages(): string[] {
  const { files }: { files: string[] } = parse(
    readFileSync(join(root, "electron-builder.yml"), "utf8"),
  );
  const entry = files
    .map((file) => /^!node_modules\/\{([^}]+)\}\//.exec(file))
    .find(Boolean);
  return entry ? entry[1].split(",") : [];
}

const isStripped = (name: string, stripped: string[]) =>
  stripped.some((pattern) =>
    pattern.endsWith("/*")
      ? name.startsWith(pattern.slice(0, -1))
      : pattern === name,
  );

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /(?<!\.test|\.d)\.ts$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

// Static (not `import type`), side-effect, `export … from` and dynamic imports
const IMPORT =
  /^\s*(?:import|export)\s+(type\s)?[^;"']*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;

// The package a specifier names, if it's one from node_modules
function packageOf(specifier: string): string | undefined {
  if (/^(\.|@\/|node:)/.test(specifier)) return undefined;
  const [first, second] = specifier.split("/");
  if (builtinModules.includes(first)) return undefined;
  return first.startsWith("@") ? `${first}/${second}` : first;
}

// The folder Node loads a package from, walking up from the dependent's
function resolvePackage(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const folder = join(dir, "node_modules", name);
    if (existsSync(join(folder, "package.json"))) return folder;
    if (dirname(dir) === dir) return undefined;
  }
}

function runtimeDependencies(folder: string): string[] {
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  const optionalPeers = pkg.peerDependenciesMeta ?? {};
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}).filter(
      (name) => !optionalPeers[name]?.optional,
    ),
  ];
}

// Every package main can load, by folder, with the chain that reaches it
function reachedPackages(): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const queue: [string, string[]][] = [];
  const visit = (name: string, from: string, chain: string[]) => {
    // The runtime itself, which the package doesn't ship
    if (name === "electron") return;
    const folder = resolvePackage(name, from);
    // A missing optional dependency, such as another platform's binary
    if (!folder || reached.has(folder)) return;
    reached.set(folder, [...chain, name]);
    queue.push([folder, [...chain, name]]);
  };

  for (const file of ["src/main", "src/common"].flatMap((dir) =>
    sourceFiles(join(root, dir)),
  )) {
    for (const [, type, ...specifiers] of readFileSync(file, "utf8").matchAll(
      IMPORT,
    )) {
      const name = packageOf(specifiers.find(Boolean)!);
      if (!type && name) visit(name, root, [relative(root, file)]);
    }
  }
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [folder, chain] = next;
    for (const name of runtimeDependencies(folder)) visit(name, folder, chain);
  }
  return reached;
}

describe("packaging", () => {
  it("keeps main off the packages electron-builder strips", () => {
    const stripped = strippedPackages();
    const chains = [...reachedPackages().values()];

    expect(stripped).toContain("react");
    // The walk follows dependencies, so a stripped package can't hide behind one.
    expect(chains).toContainEqual([
      expect.stringMatching(/^src[\\/]main[\\/]/),
      "express",
      "body-parser",
    ]);
    expect(
      chains
        .filter((chain) => isStripped(chain.at(-1)!, stripped))
        .map((chain) => chain.join(" > ")),
    ).toEqual([]);
  });
});
