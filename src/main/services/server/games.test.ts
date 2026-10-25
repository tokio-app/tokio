import STYLES from "@/common/games/overlay.css?raw";
import { GamesOverlaySchema } from "@/common/schemas";
import { GameOverlayRow, TOKIO_EVENTS } from "@/common/types";
import { GAMES_PATH } from "@/common/util";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerService } from "./index";

const look = GamesOverlaySchema.parse({});

const row = (
  id: string,
  patch: Partial<GameOverlayRow> = {},
): GameOverlayRow => ({
  id,
  pictures: [],
  event: "Follow",
  image: `/games/minecraft/${id}.png`,
  name: id.toUpperCase(),
  ...patch,
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

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
      expect(html).toContain("tokio:games");
      expect(html).toContain("url(data:font/woff2;base64,");
      expect(html).toContain(STYLES);
      expect(html).toContain(".games-slot");
      expect(html).not.toContain("__ARCHIVO__");
      expect(html).not.toContain("__STYLES__");
    }
  });

  describe("page", () => {
    let dom: JSDOM;
    const document = () => dom.window.document;
    const send = (rows: GameOverlayRow[], lookPatch: object = {}) =>
      server.sendToClient(GAMES_PATH, {
        type: "tokio:games",
        data: { look: { ...look, ...lookPatch }, rows },
      });
    const run = (id: string) =>
      server.sendToClient(GAMES_PATH, {
        type: "tokio:games:run",
        data: { id },
      });
    const rowElements = () => [...document().querySelectorAll(".games-row")];
    const texts = () =>
      rowElements().map((li) =>
        [...li.querySelectorAll(".games-text")].map((t) => t.textContent),
      );
    const lit = () =>
      rowElements()
        .filter((li) => li.classList.contains("games-lit"))
        .map((li) => li.querySelector(".games-name")?.textContent);
    const current = () =>
      document().querySelector(".games-current .games-name")?.textContent;

    beforeEach(async () => {
      const page = url("/games/");
      dom = new JSDOM(await (await fetch(page)).text(), {
        url: page,
        runScripts: "dangerously",
      });
      await vi.waitFor(() => expect(send([])).toBe(true));
    });

    afterEach(() => {
      dom.window.close();
    });

    it("draws a row per action: the event, an arrow, the picture and name", async () => {
      send([
        row("tnt", {
          event: "Rose or Lion",
          pictures: ["https://cdn/rose.png", "https://cdn/lion.png"],
        }),
        row("creeper", { event: "100 likes", image: null }),
      ]);

      await vi.waitFor(() => expect(rowElements()).toHaveLength(2));
      expect(texts()).toEqual([
        ["Rose or Lion", "TNT"],
        ["100 likes", "CREEPER"],
      ]);
      const [tnt, creeper] = rowElements();
      expect(
        [...tnt.querySelectorAll("img")].map((img) => img.getAttribute("src")),
      ).toEqual([
        "https://cdn/rose.png",
        "https://cdn/lion.png",
        "/games/minecraft/tnt.png",
      ]);
      expect(tnt.querySelector(".games-slot-result img")!.src).toBe(
        url("/games/minecraft/tnt.png"),
      );
      expect(tnt.querySelector(".games-arrow")).not.toBeNull();
      expect(creeper.querySelectorAll("img")).toHaveLength(0);
      expect(
        [...creeper.querySelectorAll(".games-side")].map((side) =>
          side.classList.contains("has-picture"),
        ),
      ).toEqual([false, false]);
    });

    it("puts texts in as text, never markup", async () => {
      send([row("a", { event: "<b>Rose</b>", name: "<img src=x>" })]);

      await vi.waitFor(() =>
        expect(texts()).toEqual([["<b>Rose</b>", "<img src=x>"]]),
      );
      expect(document().querySelectorAll("b")).toHaveLength(0);
      expect(document().querySelectorAll("img")).toHaveLength(1);
    });

    it("leaves the name out when there is none", async () => {
      send([row("a", { name: "" })]);

      await vi.waitFor(() => expect(texts()).toEqual([["Follow"]]));
      expect(document().querySelector(".games-result img")).not.toBeNull();
    });

    it("hides the texts next to pictures with Pictures only", async () => {
      send([row("a")], { pictures_only: false });
      await vi.waitFor(() => expect(rowElements()).toHaveLength(1));
      const games = document().getElementById("games")!;
      expect(games.classList.contains("games-pictures-only")).toBe(false);

      send([row("a")], { pictures_only: true });
      await vi.waitFor(() =>
        expect(games.classList.contains("games-pictures-only")).toBe(true),
      );
      // The stylesheet hides the texts of the sides with a picture
      expect(document().querySelector(".games-result.has-picture")).not.toBe(
        null,
      );
      expect(document().querySelector(".games-event.has-picture")).toBe(null);
    });

    it("hides a picture that doesn't load, and shows its side's text", async () => {
      send([row("a", { pictures: ["https://cdn/rose.png"] })]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(1));
      const [rose, picture] = [...document().querySelectorAll("img")];

      picture.dispatchEvent(new dom.window.Event("error"));

      const result = document().querySelector(".games-result")!;
      expect(result.querySelector(".games-slot")).toBeNull();
      expect(result.classList.contains("has-picture")).toBe(false);
      expect(rose.isConnected).toBe(true);
    });

    it("applies the colors and font, without letting a name add styles", async () => {
      send([row("a")], {
        text_color: "#112233",
        accent_color: "#44556677",
        font: ' x"; color: red ',
      });

      const games = document().getElementById("games")!;
      await vi.waitFor(() =>
        expect(games.style.getPropertyValue("--games-text")).toBe("#112233"),
      );
      expect(games.style.getPropertyValue("--games-accent")).toBe("#44556677");
      expect(games.style.fontFamily).toContain('x\\"; color: red');
      expect(games.style.fontFamily).toMatch(
        /, "Archivo Variable", sans-serif$/,
      );
      expect(games.style.color).toBe("");

      send([row("a")], { font: "  " });
      await vi.waitFor(() => expect(games.style.fontFamily).toBe(""));
    });

    it("ignores the live events every overlay gets", async () => {
      send([row("a")]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(1));

      server.sendToClient(GAMES_PATH, {
        type: TOKIO_EVENTS.FOLLOW,
        data: { user: { username: "Viewer", handle: "viewer" } },
      });
      send([row("a"), row("b")]);

      await vi.waitFor(() => expect(rowElements()).toHaveLength(2));
    });

    it("lights a row when it runs, 1.5 s after its last run", async () => {
      send([row("a"), row("b")]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(2));

      run("b");
      await vi.waitFor(() => expect(lit()).toEqual(["B"]));
      await sleep(900);
      // A burst keeps it lit
      run("b");
      await sleep(900);
      expect(lit()).toEqual(["B"]);

      await vi.waitFor(() => expect(lit()).toEqual([]), { timeout: 1000 });
    });

    it("keeps a lit row lit when the rows come again unchanged", async () => {
      send([row("a")]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(1));
      run("a");
      await vi.waitFor(() => expect(lit()).toEqual(["A"]));
      const [li] = rowElements();

      send([row("a")], { text_color: "#000000" });
      const games = document().getElementById("games")!;
      await vi.waitFor(() =>
        expect(games.style.getPropertyValue("--games-text")).toBe("#000000"),
      );

      expect(rowElements()).toEqual([li]);
      expect(lit()).toEqual(["A"]);
    });

    it("shows one row at a time, turning every 3 s", async () => {
      send([row("a"), row("b")], { layout: "carousel" });
      await vi.waitFor(() => expect(current()).toBe("A"));
      const games = document().getElementById("games")!;
      expect(games.classList.contains("games-carousel")).toBe(true);

      await vi.waitFor(() => expect(current()).toBe("B"), { timeout: 3500 });
      await vi.waitFor(() => expect(current()).toBe("A"), { timeout: 3500 });
    }, 10_000);

    it("turns to a row that runs, and holds it while it's lit", async () => {
      send([row("a"), row("b"), row("c")], { layout: "carousel" });
      await vi.waitFor(() => expect(current()).toBe("A"));

      run("c");
      await vi.waitFor(() => expect(current()).toBe("C"), { timeout: 200 });
      // Lit past its turn, which would have ended at 3 s
      await sleep(1000);
      run("c");
      await sleep(1000);
      run("c");
      await sleep(1300);
      expect(current()).toBe("C");

      // Once out, it turns again
      await vi.waitFor(() => expect(current()).toBe("A"), { timeout: 3500 });
    }, 12_000);
  });
});
