import STYLES from "@/common/studio/overlay.css?raw";
import STAGE from "@/common/studio/stage.ts?script";
import type { StudioLayerView, StudioReact, StudioView } from "@/common/types";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerService } from "./index";

const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";
const SOCKET = `studio:${ID}`;

const BASE = {
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  z: 0,
  opacity: 1,
  when: "always",
  seconds: 5,
  entrance: "pop",
  animation: "bounce",
} as const;

// A layer of the kind, with its own fields
type Own<L> = L extends StudioLayerView
  ? Omit<L, keyof typeof BASE | "id">
  : never;
const layer = (
  id: string,
  fields: Own<StudioLayerView>,
  base: { when?: StudioLayerView["when"]; x?: number } = {},
): StudioLayerView => ({ ...BASE, ...base, id, ...fields });

const TEXT = {
  kind: "text",
  text: "Hi",
  font: "",
  size: 64,
  color: "#f1f5f9",
  align: "center",
  bold: true,
  halo: true,
} as const;

const view = (...layers: StudioLayerView[]): StudioView => ({
  width: 1080,
  height: 1920,
  layers,
});

describe("studio overlay page", () => {
  let server: ServerService;
  const url = (path: string) => `http://127.0.0.1:${server.getPort()}${path}`;

  beforeEach(async () => {
    server = new ServerService(0);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("serves the page with the font, its look and the stage inlined", async () => {
    for (const path of [`/studio/${ID}/`, `/studio/${ID}`]) {
      const res = await fetch(url(path));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      const html = await res.text();
      expect(html).toContain("url(data:font/woff2;base64,");
      expect(html).toContain(STYLES);
      expect(html).toContain(STAGE);
      expect(html).not.toMatch(/__ARCHIVO__|__STYLES__|__STAGE__/);
      // Only its own two scripts end: the stage can't close one early
      expect(html.match(/<\/script/gi)).toHaveLength(2);
    }
  });

  it("inlines the stage as a plain script, with no imports", () => {
    expect(STAGE).toContain("var TokioStage");
    expect(STAGE).not.toMatch(/^\s*(import|export)\b/m);
    expect(STAGE).not.toMatch(/<\/script/i);
  });

  describe("page", () => {
    let dom: JSDOM;
    const document = () => dom.window.document;
    const send = (v: StudioView | null) =>
      server.sendToClient(SOCKET, { type: "tokio:studio", data: { view: v } });
    const react = (r: StudioReact) =>
      server.sendToClient(SOCKET, { type: "tokio:studio:react", data: r });
    const el = (id: string) =>
      document().querySelector<HTMLElement>(`[data-layer="${id}"]`);
    const body = (id: string) =>
      el(id)!.querySelector<HTMLElement>(".studio-body")!;

    beforeEach(async () => {
      const page = url(`/studio/${encodeURIComponent(ID)}/`);
      dom = new JSDOM(await (await fetch(page)).text(), {
        url: page,
        runScripts: "dangerously",
        beforeParse(window) {
          // jsdom doesn't play media.
          window.HTMLMediaElement.prototype.play = () => Promise.resolve();
          window.HTMLMediaElement.prototype.pause = () => {};
          window.HTMLMediaElement.prototype.load = () => {};
        },
      });
      // Its socket connects with the id from its URL
      await vi.waitFor(() => expect(send(null)).toBe(true));
    });

    // Before the server stops, or the page keeps reconnecting
    afterEach(() => {
      dom.window.close();
    });

    it("draws every kind of layer", async () => {
      send(
        view(
          layer("t", TEXT),
          layer("m", {
            kind: "media",
            src: "/alerts/media/a.png",
            video: false,
          }),
          layer("v", {
            kind: "media",
            src: "/alerts/media/a.webm",
            video: true,
          }),
          layer("g", { kind: "gift", src: "https://cdn/rose.png" }),
          layer("e", { kind: "emote", src: "https://cdn/emote.png" }),
          layer("s", { kind: "shape", color: "#18181b", radius: 24 }),
          layer("w", { kind: "viewer", src: "", name: "ana" }),
          layer("o", {
            kind: "overlay",
            source: { type: "timer" },
            src: "/timer/",
            label: "",
          }),
        ),
      );

      await vi.waitFor(() => expect(el("o")).not.toBeNull());
      expect(el("t")!.querySelector(".studio-text")?.textContent).toBe("Hi");
      expect(el("m")!.querySelector("img")?.getAttribute("src")).toBe(
        "/alerts/media/a.png",
      );
      expect(el("v")!.querySelector("video")?.getAttribute("src")).toBe(
        "/alerts/media/a.webm",
      );
      expect(el("g")!.querySelector("img")?.getAttribute("src")).toBe(
        "https://cdn/rose.png",
      );
      expect(el("e")!.querySelector("img")?.getAttribute("src")).toBe(
        "https://cdn/emote.png",
      );
      expect(el("s")!.style.getPropertyValue("--studio-color")).toBe("#18181b");
      expect(el("w")!.querySelector(".studio-initial")?.textContent).toBe("A");
      expect(el("o")!.querySelector("iframe")?.getAttribute("src")).toBe(
        "/timer/",
      );
    });

    it("shows a layer on its react, and a second one starts it again", async () => {
      send(view(layer("t", TEXT, { when: "event" })));
      await vi.waitFor(() => expect(el("t")).not.toBeNull());
      expect(body("t").classList.contains("studio-hidden")).toBe(true);

      react({ layer: "t", text: "Thanks Ana" });
      await vi.waitFor(() =>
        expect(body("t").classList.contains("studio-hidden")).toBe(false),
      );
      expect(body("t").textContent).toBe("Thanks Ana");
      expect(body("t").classList.contains("studio-enter-pop")).toBe(true);

      body("t").classList.remove("studio-enter-pop");
      react({ layer: "t", text: "Thanks Bo" });
      await vi.waitFor(() => expect(body("t").textContent).toBe("Thanks Bo"));
      expect(body("t").classList.contains("studio-enter-pop")).toBe(true);
    });

    it("plays an animate layer's animation on each react", async () => {
      send(
        view(
          layer(
            "s",
            { kind: "shape", color: "#18181b", radius: 0 },
            { when: "animate" },
          ),
        ),
      );
      await vi.waitFor(() => expect(el("s")).not.toBeNull());
      expect(body("s").classList.contains("studio-hidden")).toBe(false);

      react({ layer: "s" });
      await vi.waitFor(() =>
        expect(body("s").classList.contains("studio-play-bounce")).toBe(true),
      );
      body("s").classList.remove("studio-play-bounce");
      react({ layer: "s" });
      await vi.waitFor(() =>
        expect(body("s").classList.contains("studio-play-bounce")).toBe(true),
      );
    });

    it("keeps an embed's iframe through an update", async () => {
      const embed = (x: number) =>
        layer(
          "o",
          {
            kind: "overlay",
            source: { type: "installed", id: "gift-jar" },
            src: "/gift-jar/",
            label: "",
          },
          { x },
        );
      send(view(embed(0)));
      await vi.waitFor(() =>
        expect(el("o")?.querySelector("iframe")).toBeTruthy(),
      );
      const frame = el("o")!.querySelector("iframe");

      send(view(embed(50), layer("t", TEXT)));

      await vi.waitFor(() => expect(el("t")).not.toBeNull());
      expect(el("o")!.style.left).toBe("50px");
      expect(el("o")!.querySelector("iframe")).toBe(frame);
    });

    it("hides a picture that fails to load", async () => {
      send(view(layer("g", { kind: "gift", src: "https://cdn/missing.png" })));
      await vi.waitFor(() => expect(el("g")).not.toBeNull());
      const img = el("g")!.querySelector("img")!;

      img.dispatchEvent(new dom.window.Event("error"));

      expect(img.classList.contains("studio-failed")).toBe(true);
    });

    it("clears everything on a null view", async () => {
      send(view(layer("t", TEXT)));
      await vi.waitFor(() => expect(el("t")).not.toBeNull());

      send(null);

      await vi.waitFor(() => expect(el("t")).toBeNull());
    });

    it("ignores the live events every client gets", async () => {
      send(view(layer("t", TEXT)));
      await vi.waitFor(() => expect(el("t")).not.toBeNull());

      server.sendToClient(SOCKET, {
        type: "tokio:event:follow",
        data: { user: { username: "Ana" } },
      });
      send(view(layer("t", { ...TEXT, text: "Later" })));

      await vi.waitFor(() => expect(body("t").textContent).toBe("Later"));
    });
  });
});
