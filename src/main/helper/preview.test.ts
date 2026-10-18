import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { previewFile, withPreviewBackground, withPreviewCORS } from "./preview";

const page = "<!doctype html><html><body>Overlay</body></html>";

// The URL the renderer's Iframe builds for a file on disk.
const previewURL = (file: string) =>
  pathToFileURL(file).href.replace(/^file:/, "local-resource:");

describe("previewFile", () => {
  const folder = resolve("tokio-data", "overlays");

  it("serves files inside the overlays folder", () => {
    const file = join(folder, "a", "assets", "index.js");
    expect(previewFile(previewURL(file), folder)).toBe(file);
  });

  it("decodes the path", () => {
    const file = join(folder, "my overlay", "index.html");
    expect(previewFile(previewURL(file), folder)).toBe(file);
  });

  it("refuses files outside the overlays folder", () => {
    const outside = [
      previewURL(resolve("tokio-data", "settings", "store.json")),
      previewURL(`${folder}-old${join("/", "a", "index.html")}`),
      `${previewURL(folder)}/a/%2E%2E/%2E%2E/settings/store.json`,
      previewURL(folder),
    ];
    for (const url of outside) expect(previewFile(url, folder)).toBeNull();
  });

  it("refuses everything before the folders are known", () => {
    const file = join(folder, "a", "index.html");
    expect(previewFile(previewURL(file), undefined)).toBeNull();
  });
});

describe("withPreviewCORS", () => {
  it("lets previews load their own files", async () => {
    const res = withPreviewCORS(
      new Response("console.log(1)", {
        status: 200,
        headers: { "content-type": "text/javascript" },
      }),
    );

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(await res.text()).toBe("console.log(1)");
  });
});

describe("withPreviewBackground", () => {
  it("adds an opaque background after the overlay's page", async () => {
    const res = await withPreviewBackground(
      new Response(page, {
        headers: { "content-type": "text/html", "content-length": "48" },
      }),
      "C:/overlays/a/index.html",
    );

    const html = await res.text();
    expect(html.startsWith(page)).toBe(true);
    expect(html).toContain("<style>html{background-color:#121212!important}");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("leaves other files and failed reads alone", async () => {
    const script = new Response("console.log(1)");
    expect(await withPreviewBackground(script, "/overlays/a/app.js")).toBe(
      script,
    );

    const missing = new Response(null, { status: 404 });
    expect(await withPreviewBackground(missing, "/overlays/a/index.html")).toBe(
      missing,
    );
  });
});
