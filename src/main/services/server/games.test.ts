import STYLES from "@/common/games/overlay.css?raw";
import { GamesOverlaySchema } from "@/common/schemas";
import { GameOverlayRow, TOKIO_EVENTS } from "@/common/types";
import { GAMES_PATH, MINECRAFT_PICTURES_PATH } from "@/common/util";
import { JSDOM } from "jsdom";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerService } from "./index";

const look = GamesOverlaySchema.parse({});

const row = (
  id: string,
  patch: Partial<GameOverlayRow> = {},
): GameOverlayRow => ({
  id,
  pictures: [],
  event: "Any gift",
  withText: false,
  eventCount: 0,
  image: `/games/minecraft/pictures/${id}.png`,
  name: id.toUpperCase(),
  count: 0,
  column: 1,
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

  it("serves Minecraft's page, every column or one, with the font and its look inlined", async () => {
    for (const path of [
      "/games/minecraft/",
      "/games/minecraft",
      "/games/minecraft/2/",
      "/games/minecraft/2",
    ]) {
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

  it("leaves other paths under /games/ to the overlays and the pictures", async () => {
    const folder = await mkdtemp(join(tmpdir(), "tokio-test-"));
    try {
      await writeFile(join(folder, "tnt.png"), "png");
      server.mount(MINECRAFT_PICTURES_PATH, folder);

      const picture = await fetch(url("/games/minecraft/pictures/tnt.png"));
      expect(picture.status).toBe(200);
      expect(await picture.text()).toBe("png");
      for (const path of ["/games/", "/games/minecraft/two/"]) {
        expect((await fetch(url(path))).status).toBe(404);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
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
      const page = url("/games/minecraft/");
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
        "/games/minecraft/pictures/tnt.png",
      ]);
      expect(tnt.querySelector(".games-slot-result img")!.src).toBe(
        url("/games/minecraft/pictures/tnt.png"),
      );
      expect(tnt.querySelector(".games-arrow")).not.toBeNull();
      expect(creeper.querySelectorAll("img")).toHaveLength(0);
      expect(
        [...creeper.querySelectorAll(".games-side")].map((side) =>
          side.classList.contains("has-picture"),
        ),
      ).toEqual([false, false]);
    });

    it("shows an event's gifts in one slot, one at a time, turning every 2 s", async () => {
      send([
        row("a", {
          pictures: ["https://cdn/rose.png", "https://cdn/lion.png"],
        }),
      ]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(1));
      const slots = document().querySelectorAll(".games-event .games-slot");
      expect(slots).toHaveLength(1);
      const shown = () =>
        [...slots[0].querySelectorAll("img")]
          .filter((img) => !img.classList.contains("games-away"))
          .map((img) => img.getAttribute("src"));

      const first = shown();
      expect(first).toHaveLength(1);
      await vi.waitFor(() => expect(shown()).not.toEqual(first), {
        timeout: 2500,
      });
      expect(shown()).toHaveLength(1);
    }, 6000);

    it("shows the count on the picture's corner, none for one", async () => {
      send([row("a", { count: 5 }), row("b")]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(2));

      const [five, one] = rowElements();
      expect(
        five.querySelector(".games-slot-result .games-count")?.textContent,
      ).toBe("5");
      expect(one.querySelector(".games-count")).toBeNull();
    });

    it("counts the likes on the heart, and shows a chat's message by its bubble", async () => {
      send(
        [
          row("a", {
            pictures: ["https://cdn/heart.svg"],
            event: "100 likes",
            eventCount: 100,
          }),
          row("b", {
            pictures: ["https://cdn/chat.svg"],
            event: "“tnt”",
            withText: true,
          }),
          row("c", {
            pictures: ["https://cdn/chat.svg"],
            event: "",
            withText: true,
          }),
        ],
        { pictures_only: true },
      );
      await vi.waitFor(() => expect(rowElements()).toHaveLength(3));
      const [likes, chat, anyChat] = rowElements().map((li) =>
        li.querySelector(".games-event")!,
      );

      expect(likes.querySelector(".games-slot .games-count")?.textContent).toBe(
        "100",
      );
      expect(likes.classList.contains("has-picture")).toBe(true);
      // Without has-picture, Pictures only keeps the message
      expect(chat.classList.contains("has-picture")).toBe(false);
      expect(chat.querySelector(".games-text")?.textContent).toBe("“tnt”");
      expect(chat.querySelector(".games-slot img")).not.toBeNull();
      expect(anyChat.querySelector(".games-text")).toBeNull();
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

      await vi.waitFor(() => expect(texts()).toEqual([["Any gift"]]));
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

    it("puts the texts below the pictures in either format", async () => {
      send([row("a")], { format: "arrow", text_below: true });
      const games = document().getElementById("games")!;
      await vi.waitFor(() =>
        expect(games.classList.contains("games-text-below")).toBe(true),
      );

      send([row("a")], { format: "sticker", text_below: false });
      await vi.waitFor(() =>
        expect(games.classList.contains("games-sticker")).toBe(true),
      );
      expect(games.classList.contains("games-text-below")).toBe(false);
    });

    it("sizes the event's pictures", async () => {
      send([row("a")], { event_size: "large" });
      const games = document().getElementById("games")!;
      await vi.waitFor(() =>
        expect(games.classList.contains("games-event-large")).toBe(true),
      );

      send([row("a")], { event_size: "medium" });
      await vi.waitFor(() =>
        expect(games.classList.contains("games-event-medium")).toBe(true),
      );
      expect(games.classList.contains("games-event-large")).toBe(false);

      // Small is the stylesheet's own
      send([row("a")], { event_size: "small" });
      await vi.waitFor(() =>
        expect(games.classList.contains("games-event-medium")).toBe(false),
      );
    });

    it("hides a picture that doesn't load, and shows its side's text", async () => {
      send([row("a", { pictures: ["https://cdn/rose.png"] })]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(1));
      const [rose, picture] = [...document().querySelectorAll("img")];

      picture.dispatchEvent(new dom.window.Event("error"));

      const result = document().querySelector(".games-result")!;
      expect(result.querySelector(".games-slot")).toBeNull();
      expect(result.classList.contains("has-picture")).toBe(false);
      expect(rowElements()[0].classList.contains("has-result-picture")).toBe(
        false,
      );
      expect(rose.isConnected).toBe(true);
    });

    it("keeps a small Minecraft picture drawn large sharp, and a big one smooth", async () => {
      send([row("a"), row("b")]);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(2));
      const [small, big] = [
        ...document().querySelectorAll<HTMLImageElement>(
          ".games-slot-result img",
        ),
      ];
      // JSDOM loads no pictures and lays nothing out
      const load = (img: HTMLImageElement, natural: number, drawn: number) => {
        Object.defineProperty(img, "naturalWidth", { value: natural });
        Object.defineProperty(img, "clientWidth", { value: drawn });
        img.dispatchEvent(new dom.window.Event("load"));
      };

      load(small, 16, 120);
      load(big, 300, 120);

      expect(small.classList.contains("games-pixelated")).toBe(true);
      expect(big.classList.contains("games-pixelated")).toBe(false);
    });

    it("puts the event's picture on the action's with stickers", async () => {
      const rows = [row("a"), row("b", { image: null })];
      send(rows, { format: "sticker" });
      const games = document().getElementById("games")!;

      await vi.waitFor(() =>
        expect(games.classList.contains("games-sticker")).toBe(true),
      );
      // Without the action's picture, the event's takes its place
      expect(
        rowElements().map((li) => li.classList.contains("has-result-picture")),
      ).toEqual([true, false]);

      send(rows, { format: "arrow" });
      await vi.waitFor(() =>
        expect(games.classList.contains("games-sticker")).toBe(false),
      );
    });

    it("applies the colors and font, without letting a name add styles", async () => {
      send([row("a")], {
        text_color: "#112233",
        accent_color: "#44556677",
        arrow_color: "#abcdef",
        font: ' x"; color: red ',
      });

      const games = document().getElementById("games")!;
      await vi.waitFor(() =>
        expect(games.style.getPropertyValue("--games-text")).toBe("#112233"),
      );
      expect(games.style.getPropertyValue("--games-accent")).toBe("#44556677");
      expect(games.style.getPropertyValue("--games-arrow")).toBe("#abcdef");
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

    it("shows every column's rows, and one column's at its own path", async () => {
      const rows = [row("a"), row("b", { column: 2 }), row("c", { column: 2 })];
      send(rows);
      await vi.waitFor(() => expect(rowElements()).toHaveLength(3));

      const page = url("/games/minecraft/2/");
      const second = new JSDOM(await (await fetch(page)).text(), {
        url: page,
        runScripts: "dangerously",
      });
      try {
        const names = () =>
          [...second.window.document.querySelectorAll(".games-name")].map(
            (name) => name.textContent,
          );
        await vi.waitFor(() => {
          send(rows);
          expect(names()).toEqual(["B", "C"]);
        });
      } finally {
        second.window.close();
      }
    });

    it("shows one row at a time, turning every 3 s", async () => {
      send([row("a"), row("b")], { layout: "carousel" });
      await vi.waitFor(() => expect(current()).toBe("A"));
      const games = document().getElementById("games")!;
      expect(games.classList.contains("games-carousel")).toBe(true);

      await vi.waitFor(() => expect(current()).toBe("B"), { timeout: 3500 });
      await vi.waitFor(() => expect(current()).toBe("A"), { timeout: 3500 });
    }, 10_000);

    it("waits for a row's gifts to take their turns before the next row", async () => {
      const gifts = ["https://cdn/rose.png", "https://cdn/lion.png"];
      send([row("a", { pictures: gifts }), row("b")], { layout: "carousel" });
      await vi.waitFor(() => expect(current()).toBe("A"));
      const shown = () =>
        [...document().querySelectorAll(".games-current .games-event img")]
          .filter((img) => !img.classList.contains("games-away"))
          .map((img) => img.getAttribute("src"));

      // From its first gift
      expect(shown()).toEqual([gifts[0]]);
      await sleep(2300);
      expect(shown()).toEqual([gifts[1]]);
      // Past the 3 s a row with one gift gets
      await sleep(1000);
      expect(current()).toBe("A");
      await vi.waitFor(() => expect(current()).toBe("B"), { timeout: 1500 });
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
