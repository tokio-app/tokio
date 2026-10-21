import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LicensesService } from "./index";

let root: string;
let service: LicensesService;

const pkg = async (
  dir: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(dir, name), text);
  }
};

const modules = (...parts: string[]) =>
  join(root, ...parts.flatMap((p) => ["node_modules", p]));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tokio-test-"));
  service = new LicensesService();
  service.initialize(root, root);

  await pkg(root, {
    name: "app",
    dependencies: { a: "^1.0.0", "@scope/b": "^1.0.0" },
    optionalDependencies: { missing: "^1.0.0" },
    devDependencies: { dev: "^1.0.0" },
  });
  // a depends on c@2, nested, and on the hoisted c@1 through @scope/b
  await pkg(
    modules("a"),
    {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      author: "Jane Doe <jane@example.com> (https://example.com)",
      repository: "git+https://github.com/jane/a.git",
      dependencies: { c: "^2.0.0" },
    },
    { LICENSE: "MIT text of a" },
  );
  await pkg(
    modules("a", "c"),
    {
      name: "c",
      version: "2.0.0",
      licenses: [{ type: "MIT" }, { type: "Apache-2.0" }],
      repository: { url: "github:someone/c" },
    },
    { "LICENSE.md": "license of c2", NOTICE: "notice of c2" },
  );
  await pkg(modules("@scope/b"), {
    name: "@scope/b",
    version: "1.0.0",
    license: "AGPL-3.0-only",
    author: { name: "Scope" },
    homepage: "javascript:alert(1)",
    dependencies: { c: "^1.0.0", "../evil": "1.0.0" },
    peerDependencies: { dev: "^1.0.0" },
  });
  await pkg(modules("c"), {
    name: "c",
    version: "1.0.0",
    license: "ISC",
    homepage: "https://c.example.com",
  });
  await pkg(modules("dev"), { name: "dev", version: "1.0.0", license: "MIT" });

  await mkdir(join(root, "LICENSES"));
  await writeFile(join(root, "LICENSES", "LGPL-3.0.txt"), "LGPL text");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LicensesService", () => {
  it("lists the production dependency tree, copyleft first", async () => {
    const res = await service.getPackages();

    expect(res.success).toBe(true);
    expect(res.data!.map((p) => p.id)).toEqual([
      "@scope/b@1.0.0",
      "a@1.0.0",
      "c@1.0.0",
      "c@2.0.0",
    ]);
    expect(res.data![0].copyleft).toBe(true);
    expect(res.data!.filter((p) => p.copyleft)).toHaveLength(1);
  });

  it("reads the license, author and an http(s) url", async () => {
    const res = await service.getPackages();
    const byId = Object.fromEntries(res.data!.map((p) => [p.id, p]));

    expect(byId["a@1.0.0"]).toMatchObject({
      license: "MIT",
      author: "Jane Doe",
      url: "https://github.com/jane/a",
    });
    expect(byId["c@2.0.0"]).toMatchObject({
      license: "MIT OR Apache-2.0",
      url: "https://github.com/someone/c",
    });
    expect(byId["c@1.0.0"].url).toBe("https://c.example.com");
    expect(byId["@scope/b@1.0.0"]).toMatchObject({ author: "Scope" });
    expect(byId["@scope/b@1.0.0"].url).toBeUndefined();
  });

  it("returns a package's license and notice files", async () => {
    await service.getPackages();
    const res = await service.getText("c@2.0.0");

    expect(res.success).toBe(true);
    expect(res.data!.title).toBe("c 2.0.0 (MIT OR Apache-2.0)");
    expect(res.data!.text).toMatch(/LICENSE\.md[\s\S]*license of c2/);
    expect(res.data!.text).toMatch(/NOTICE[\s\S]*notice of c2/);
    expect(res.data!.text.indexOf("license of c2")).toBeLessThan(
      res.data!.text.indexOf("notice of c2"),
    );
  });

  it("explains when a package has no license file", async () => {
    const res = await service.getText("c@1.0.0");

    expect(res.success).toBe(true);
    expect(res.data!.text).toContain("ISC");
  });

  it("reads the shipped documents", async () => {
    const res = await service.getText("LGPL-3.0");

    expect(res.data).toMatchObject({
      id: "LGPL-3.0",
      text: "LGPL text",
      markdown: false,
    });
    expect(service.getDocuments().map((d) => d.id)).toContain("notices");
  });

  it("rejects ids it didn't list", async () => {
    for (const id of ["dev@1.0.0", "../package.json", "LICENSES/x"]) {
      expect((await service.getText(id)).success).toBe(false);
    }
  });

  it("fails without the app's package.json, and retries later", async () => {
    await rm(join(root, "package.json"));
    expect((await service.getPackages()).success).toBe(false);

    await pkg(root, { name: "app", dependencies: { c: "^1.0.0" } });
    expect((await service.getPackages()).data).toHaveLength(1);
  });
});
