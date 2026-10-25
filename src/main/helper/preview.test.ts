import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getMediaPreviewURL,
  getPicturePreviewURL,
  getSoundPreviewURL,
} from "@/common/util";
import {
  mediaFile,
  previewFile,
  videoResponse,
  withPreviewCORS,
  withPreviewStyles,
} from "./preview";

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

describe("mediaFile", () => {
  const folders = {
    mediaFolder: resolve("tokio-data", "media"),
    soundsFolder: resolve("tokio-data", "sounds"),
    minecraftFolder: resolve("tokio-data", "games", "minecraft"),
  };

  it("serves the images and videos in the media folder", () => {
    for (const file of ["c0ffee.png", "My clip.webm"]) {
      expect(mediaFile(getMediaPreviewURL(file), folders)).toBe(
        join(folders.mediaFolder, file),
      );
    }
  });

  it("serves the audio in the sounds folder", () => {
    for (const file of ["c0ffee.mp3", "My horn.OGG"]) {
      expect(mediaFile(getSoundPreviewURL(file), folders)).toBe(
        join(folders.soundsFolder, file),
      );
    }
  });

  it("serves the images in the Minecraft pictures folder", () => {
    for (const file of ["c0ffee.png", "My TNT.GIF", "zombie.webp"]) {
      expect(mediaFile(getPicturePreviewURL(file), folders)).toBe(
        join(folders.minecraftFolder, file),
      );
    }
  });

  it("refuses Minecraft pictures that aren't images right in their folder", () => {
    const refused = [
      getPicturePreviewURL("clip.mp4"),
      getPicturePreviewURL("horn.mp3"),
      getPicturePreviewURL("icon.svg"),
      getPicturePreviewURL("../../settings/store.png"),
      getPicturePreviewURL(".."),
      "tokio-media:///games/minecraft/sub/a.png",
      "tokio-media:///games/minecraft/../a.png",
      "tokio-media:///games/a.png",
    ];
    for (const url of refused) expect(mediaFile(url, folders)).toBeNull();
  });

  it("refuses other files, and anything outside the folders", () => {
    const refused = [
      getMediaPreviewURL("notes.txt"),
      getMediaPreviewURL("icon.svg"),
      getMediaPreviewURL("../settings/store.png"),
      getMediaPreviewURL(".."),
      getMediaPreviewURL("horn.mp3"),
      getSoundPreviewURL("party.png"),
      getSoundPreviewURL("../settings/store.mp3"),
      "tokio-media:///sub/a.png",
      "tokio-media:///sounds/sub/a.mp3",
      "tokio-media:///sounds/../a.mp3",
      "tokio-media:///%E0%A4%A",
    ];
    for (const url of refused) expect(mediaFile(url, folders)).toBeNull();
    expect(mediaFile(getMediaPreviewURL("a.png"), undefined)).toBeNull();
  });
});

describe("videoResponse", () => {
  let dir: string;
  let video: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    video = join(dir, "clip.webm");
    await writeFile(video, "0123456789");
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("serves the whole video, saying it comes in parts", async () => {
    const res = await videoResponse(video, null);

    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/webm");
    expect(await res.text()).toBe("0123456789");
  });

  it("serves the part a player asks for, so it can seek", async () => {
    const part = async (range: string) => {
      const res = await videoResponse(video, range);
      return [res.status, res.headers.get("content-range"), await res.text()];
    };

    expect(await part("bytes=2-4")).toEqual([206, "bytes 2-4/10", "234"]);
    expect(await part("bytes=7-")).toEqual([206, "bytes 7-9/10", "789"]);
    expect(await part("bytes=-3")).toEqual([206, "bytes 7-9/10", "789"]);
    expect(await part("bytes=8-99")).toEqual([206, "bytes 8-9/10", "89"]);
    expect(await part("bytes=10-")).toEqual([416, "bytes */10", ""]);
  });

  it("can't serve a video that's gone", async () => {
    expect((await videoResponse(join(dir, "gone.mp4"), null)).status).toBe(404);
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

describe("withPreviewStyles", () => {
  it("adds an opaque background after the overlay's page", async () => {
    const res = await withPreviewStyles(
      new Response(page, {
        headers: { "content-type": "text/html", "content-length": "48" },
      }),
      "C:/overlays/a/index.html",
    );

    const html = await res.text();
    expect(html.startsWith(page)).toBe(true);
    expect(html).toContain("html{background-color:#121212!important}");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("hides the scrollbars, since previews can't be scrolled", async () => {
    const res = await withPreviewStyles(
      new Response(page),
      "C:/overlays/a/index.html",
    );
    expect(await res.text()).toContain("html,body{overflow:hidden!important}");
  });

  it("leaves other files and failed reads alone", async () => {
    const script = new Response("console.log(1)");
    expect(await withPreviewStyles(script, "/overlays/a/app.js")).toBe(script);

    const missing = new Response(null, { status: 404 });
    expect(await withPreviewStyles(missing, "/overlays/a/index.html")).toBe(
      missing,
    );
  });
});
