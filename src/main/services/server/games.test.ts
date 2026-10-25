import STYLES from "@/common/games/overlay.css?raw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerService } from "./index";

describe("games overlay", () => {
  let server: ServerService;
  const url = (path: string) => `http://127.0.0.1:${server.getPort()}${path}`;

  beforeEach(async () => {
    server = new ServerService(0);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("serves the games page with the font and its look inlined", async () => {
    for (const path of ["/games/", "/games"]) {
      const res = await fetch(url(path));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      const html = await res.text();
      expect(html).toContain("url(data:font/woff2;base64,");
      expect(html).toContain(STYLES);
      expect(html).not.toContain("__ARCHIVO__");
      expect(html).not.toContain("__STYLES__");
    }
  });
});
