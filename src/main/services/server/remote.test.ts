import { RemoteSettings } from "@/common/schemas";
import { APP_EVENTS, MusicInfo } from "@/common/types";
import controls from "@/events/pages/controls";
import { t } from "@/helper/i18n";
import { ControlsService } from "@/services/controls";
import { createHandler } from "@test/handler";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerService } from "./index";
import {
  createRemoteRoutes,
  RemoteLabels,
  remoteLabels,
  RemoteState,
  remoteState,
} from "./remote";

const KEY = "k3y-for-the-remote-tests";

const LIVE: RemoteState = {
  paused: false,
  live: "lucia.lima",
  music: true,
  song: {
    title: "Midnight Drive - Luna Park",
    thumbnail: "https://i.ytimg.com/vi/x/hqdefault.jpg",
  },
  canReplay: true,
};

describe("remoteState", () => {
  const SONGS: MusicInfo[] = [
    { title: "Played", thumbnail: "", playing: false, played: true },
    {
      title: "Now - Band",
      thumbnail: "https://a/b.jpg",
      playing: true,
      played: false,
    },
  ];

  const read = ({
    startedAt = null as number | null,
    active = false,
    alerts = 0,
  } = {}) => {
    const controlsService = new ControlsService();
    controlsService.recordAlerts(
      Array.from({ length: alerts }, () => ({
        volume: 1,
        channel: "alerts",
        maxQueueLength: 5,
        id: "a",
      })),
    );
    const { handler } = createHandler({
      controlsService,
      connectorService: { username: "lucia.lima" },
      liveService: { startedAt },
      musicService: { isActive: () => active, songs: () => SONGS },
    });
    return remoteState(handler);
  };

  it("gives the LIVE, the song playing and whether there's an alert", () => {
    expect(read({ startedAt: 1, active: true, alerts: 1 })).toEqual({
      paused: false,
      live: "lucia.lima",
      music: true,
      song: { title: "Now - Band", thumbnail: "https://a/b.jpg" },
      canReplay: true,
    });
  });

  it("has no LIVE while connecting, and no song while music is off", () => {
    expect(read()).toEqual({
      paused: false,
      live: null,
      music: false,
      song: null,
      canReplay: false,
    });
  });
});

describe("remote routes", () => {
  let server: ServerService;
  let remote: RemoteSettings;
  let labels: RemoteLabels;
  let state: RemoteState;

  const setup = () => {
    const controlsService = new ControlsService();
    const musicService = { skip: vi.fn(() => true) };
    const h = createHandler(
      {
        controlsService,
        musicService,
        ttsService: { clearTalk: vi.fn() },
        alertsService: { clear: vi.fn() },
        gamesService: { stopRuns: vi.fn() },
      },
      { stack: controls },
    );
    const invoke = vi.fn(h.handler.invoke);
    server.setControlRoutes(
      createRemoteRoutes({
        remote: () => remote,
        state: () => ({ ...state, paused: controlsService.isPaused() }),
        invoke,
        labels: () => labels,
      }),
    );
    return { h, invoke, controlsService, musicService };
  };

  const url = (path: string) => `http://127.0.0.1:${server.getPort()}${path}`;

  const api = (
    path: string,
    { key = KEY, body }: { key?: string | null; body?: string } = {},
  ) =>
    fetch(url(`/remote/api/${path}`), {
      method: path === "state" ? "GET" : "POST",
      headers: {
        ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body,
    });

  beforeEach(async () => {
    remote = { enabled: true, key: KEY };
    labels = remoteLabels();
    state = { ...LIVE };
    server = new ServerService(0);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("passes everything on until the routes are set", async () => {
    expect((await fetch(url("/remote/"))).status).toBe(404);
  });

  it("serves the page with its labels and no key", async () => {
    setup();
    labels = { ...labels, text: { ...labels.text, title: "</script><b>" } };

    for (const path of ["/remote/", "/remote"]) {
      const res = await fetch(url(path));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      const html = await res.text();
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("url(data:font/woff2;base64,");
      expect(html).not.toContain(KEY);
      expect(html).not.toContain("</script><b>");
      const json = html.match(
        /<script type="application\/json" id="labels">([\s\S]*?)<\/script>/,
      )?.[1];
      expect(JSON.parse(json!)).toEqual(labels.text);
    }
  });

  it("refuses the API while remote control is off, even with the key", async () => {
    const { invoke } = setup();
    remote = { ...remote, enabled: false };

    for (const path of ["state", "pause"]) {
      const res = await api(path);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "off" });
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["no key", null],
    ["a wrong key", KEY.replace("k", "K")],
    ["a shorter key", KEY.slice(1)],
    ["no Bearer", undefined],
  ])("refuses %s", async (_name, key) => {
    const { invoke } = setup();

    const res =
      key === undefined
        ? await fetch(url("/remote/api/pause"), {
            method: "POST",
            headers: { Authorization: KEY },
          })
        : await api("pause", { key });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "key" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses every key while the stored one is empty", async () => {
    setup();
    remote = { enabled: true, key: "" };

    expect((await api("state", { key: "" })).status).toBe(401);
  });

  it("sends no CORS headers", async () => {
    setup();

    const res = await fetch(url("/remote/api/state"), {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers the state", async () => {
    const { controlsService } = setup();
    controlsService.setPaused(true);

    const res = await api("state");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...LIVE, paused: true });
  });

  it.each([
    ["skip-song", "skipSong", true],
    ["stop-tts", "stopTts", true],
    ["replay-alert", "replayAlert", false],
  ] as const)("runs %s as %s", async (path, action, done) => {
    const { invoke } = setup();

    const res = await api(path);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done, paused: false });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(APP_EVENTS.CONTROL, {
      action,
      paused: undefined,
    });
  });

  it("says when there was no song to skip", async () => {
    const { musicService } = setup();
    musicService.skip.mockReturnValue(false);

    expect(await (await api("skip-song")).json()).toEqual({
      done: false,
      paused: false,
    });
  });

  it("toggles the pause, or sets it", async () => {
    const { invoke, controlsService } = setup();

    expect(await (await api("pause")).json()).toEqual({
      done: true,
      paused: true,
    });
    expect(controlsService.isPaused()).toBe(true);
    expect(await (await api("pause")).json()).toMatchObject({ paused: false });

    const body = JSON.stringify({ paused: false });
    expect(await (await api("pause", { body })).json()).toMatchObject({
      paused: false,
    });
    expect(invoke).toHaveBeenLastCalledWith(APP_EVENTS.CONTROL, {
      action: "pause",
      paused: false,
    });
  });

  it.each([
    ["a wrong type", JSON.stringify({ paused: "yes" })],
    ["another field", JSON.stringify({ paused: true, action: "x" })],
    ["an array", "[]"],
    ["broken JSON", "{"],
    ["too big a body", JSON.stringify({ paused: true, pad: "x".repeat(2000) })],
  ])("refuses %s", async (_name, body) => {
    const { invoke } = setup();

    const res = await api("pause", { body });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.json()).toEqual({ error: "body" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown action", async () => {
    const { invoke } = setup();

    for (const path of ["next", "constructor", "pause/again"]) {
      expect((await api(path)).status).toBe(404);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("answers 500 with the message of a control that failed", async () => {
    const { musicService } = setup();
    musicService.skip.mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await api("skip-song");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: t("main.failure.control") });
  });

  describe("page", () => {
    let dom: JSDOM;
    let requests: { path: string; init?: RequestInit }[];
    const doc = () => dom.window.document;
    const byId = (id: string) => doc().getElementById(id)!;
    // The header: who Tokio is on, or what keeps the page from working
    const who = () => byId("who").textContent;
    const button = (action: string) =>
      doc().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    const part = (action: string, name: string) =>
      button(action).querySelector(`.${name}`)!;

    const open = async (hash: string) => {
      const page = url("/remote/");
      requests = [];
      dom = new JSDOM(await (await fetch(page)).text(), {
        url: page + hash,
        runScripts: "dangerously",
        pretendToBeVisual: true,
        beforeParse(window) {
          // jsdom has no fetch: Node's, recording what the page sends
          window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
            // The page passes paths
            const path = typeof input === "string" ? input : "";
            requests.push({ path, init });
            // jsdom's AbortSignal isn't Node's: pass its abort on
            const node = new AbortController();
            init?.signal?.addEventListener("abort", () => node.abort());
            return fetch(new URL(path, page), { ...init, signal: node.signal });
          };
        },
      });
    };

    const ready = async () => {
      await open(`#key=${KEY}`);
      await vi.waitFor(() => expect(button("pause").disabled).toBe(false));
    };

    afterEach(() => {
      dom?.window.close();
    });

    it("sends the key from the link, and never stores it", async () => {
      setup();

      await ready();

      expect(requests[0]).toEqual({
        path: "/remote/api/state",
        init: expect.objectContaining({
          method: "GET",
          headers: { Authorization: `Bearer ${KEY}` },
        }),
      });
      expect(dom.window.localStorage.length).toBe(0);
      expect(dom.window.sessionStorage.length).toBe(0);
      expect(doc().cookie).toBe("");
    });

    it("puts the labels in as text", async () => {
      setup();
      labels = {
        ...labels,
        text: { ...labels.text, skipSong: "Skip <b>now</b>", title: "<i>T" },
      };

      await open(`#key=${KEY}`);

      expect(part("skip-song", "label").textContent).toBe("Skip <b>now</b>");
      expect(part("skip-song", "label").children).toHaveLength(0);
      expect(doc().title).toBe("<i>T");
      expect(doc().querySelector("h1")!.textContent).toBe("<i>T");
    });

    it("shows the LIVE and the song playing, as text", async () => {
      setup();
      state = {
        ...LIVE,
        live: "<b>lucia",
        song: { ...LIVE.song!, title: "<i>Midnight Drive - Luna Park" },
      };

      await ready();

      expect(who()).toBe("@<b>lucia");
      expect(byId("who").children).toHaveLength(0);
      expect(doc().documentElement.classList.contains("live")).toBe(true);
      expect(byId("on-air").hidden).toBe(false);
      expect(byId("song").hidden).toBe(false);
      expect(byId("song-name").textContent).toBe("<i>Midnight Drive");
      expect(byId("song-artist").textContent).toBe("Luna Park");
      expect(byId("cover").getAttribute("src")).toBe(LIVE.song!.thumbnail);
    });

    it("shows a LIVE typed as a link as typed", async () => {
      setup();
      state = { ...LIVE, live: "https://www.twitch.tv/lucia" };

      await ready();

      expect(who()).toBe("https://www.twitch.tv/lucia");
    });

    it("asks for the state once at a time", async () => {
      setup();
      await ready();
      const before = requests.length;
      // A request that never answers
      dom.window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ path: typeof input === "string" ? input : "", init });
        return new Promise<Response>(() => {});
      };
      const visible = () =>
        doc().dispatchEvent(new dom.window.Event("visibilitychange"));

      visible();
      visible();

      expect(requests.length - before).toBe(1);
      expect(requests.at(-1)!.init!.signal).toBeDefined();
    });

    it("keeps a pressed key focusable while it waits", async () => {
      setup();
      await ready();
      const skip = button("skip-song");
      skip.focus();

      skip.click();
      skip.click();

      expect(skip.disabled).toBe(false);
      expect(skip.getAttribute("aria-disabled")).toBe("true");
      expect(doc().activeElement).toBe(skip);
      expect(requests.filter((r) => r.init?.method === "POST")).toHaveLength(1);
      await vi.waitFor(() =>
        expect(skip.hasAttribute("aria-disabled")).toBe(false),
      );
    });

    it("loads a cover only from a web address", async () => {
      setup();
      state = {
        ...LIVE,
        song: { title: "Song", thumbnail: "javascript:alert(1)" },
      };

      await ready();

      expect(byId("cover").hasAttribute("src")).toBe(false);
      expect(byId("cover").hidden).toBe(true);
      expect(byId("song-artist").textContent).toBe("");
    });

    it("says when Tokio isn't on a LIVE, and why a key can't work", async () => {
      setup();
      state = {
        ...LIVE,
        live: null,
        music: false,
        song: null,
        canReplay: false,
      };

      await ready();

      expect(who()).toBe(labels.text.notLive);
      expect(doc().documentElement.classList.contains("live")).toBe(false);
      expect(byId("on-air").hidden).toBe(true);
      expect(byId("song").hidden).toBe(true);
      expect(button("skip-song").disabled).toBe(true);
      expect(part("skip-song", "note").textContent).toBe(labels.text.noMusic);
      expect(button("replay-alert").disabled).toBe(true);
      expect(part("replay-alert", "note").textContent).toBe(
        labels.text.nothingToReplay,
      );
      expect(button("stop-tts").disabled).toBe(false);
    });

    it("says a link without a key won't work", async () => {
      setup();

      await open("");

      expect(who()).toBe(labels.text.noKey);
      expect(button("pause").disabled).toBe(true);
      expect(requests).toEqual([]);
    });

    it("says when the link no longer works", async () => {
      setup();

      await open("#key=old");

      await vi.waitFor(() => expect(who()).toBe(labels.text.newLink));
      expect(button("pause").disabled).toBe(true);
    });

    it("says when remote control is off", async () => {
      setup();
      remote = { ...remote, enabled: false };

      await open(`#key=${KEY}`);

      await vi.waitFor(() => expect(who()).toBe(labels.text.off));
    });

    it("pauses and resumes, showing the paused state", async () => {
      const { controlsService } = setup();
      await ready();
      const pause = button("pause");
      const label = () => pause.querySelector(".label")!.textContent;
      const theme = () =>
        doc()
          .querySelector('meta[name="theme-color"]')!
          .getAttribute("content");
      expect(label()).toBe(labels.text.pause);
      expect(byId("paused").hidden).toBe(true);

      pause.click();

      await vi.waitFor(() => expect(label()).toBe(labels.text.resume));
      expect(controlsService.isPaused()).toBe(true);
      // The label says it: "Resume", not "Resume, pressed"
      expect(pause.hasAttribute("aria-pressed")).toBe(false);
      expect(doc().documentElement.classList.contains("paused")).toBe(true);
      expect(byId("paused").hidden).toBe(false);
      expect(theme()).not.toBe("#121212");
      expect(requests.find((r) => r.init?.method === "POST")?.init?.body).toBe(
        JSON.stringify({ paused: true }),
      );

      // Paused elsewhere: the page follows the state it asks for
      controlsService.setPaused(false);
      // Again until it asks: a state request still running skips it
      await vi.waitFor(() => {
        doc().dispatchEvent(new dom.window.Event("visibilitychange"));
        expect(label()).toBe(labels.text.pause);
      });
      expect(theme()).toBe("#121212");
    });

    it("shows on the key what it did", async () => {
      setup();
      await ready();

      button("skip-song").click();

      await vi.waitFor(() =>
        expect(button("skip-song").hasAttribute("data-done")).toBe(true),
      );
      expect(part("skip-song", "done").textContent).toBe(labels.text.skipped);
      expect(byId("said").textContent).toBe(labels.text.skipped);
      await vi.waitFor(() => expect(button("skip-song").disabled).toBe(false));
    });

    it("shows a control's failure above the keys", async () => {
      const { musicService } = setup();
      musicService.skip.mockImplementation(() => {
        throw new Error("boom");
      });
      await ready();

      button("skip-song").click();

      await vi.waitFor(() =>
        expect(byId("failure").textContent).toBe(t("main.failure.control")),
      );
      expect(button("skip-song").hasAttribute("data-done")).toBe(false);
    });

    it("says when it can't reach Tokio", async () => {
      setup();
      await ready();
      server.stop();

      button("stop-tts").click();

      await vi.waitFor(() => expect(who()).toBe(labels.text.unreachable));
      expect(button("stop-tts").disabled).toBe(true);
    });
  });
});
