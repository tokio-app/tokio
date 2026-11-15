import { RemoteSettings } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import controls from "@/events/pages/controls";
import { t } from "@/helper/i18n";
import { ControlsService } from "@/services/controls";
import { createHandler } from "@test/handler";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerService } from "./index";
import { createRemoteRoutes, RemoteLabels, remoteLabels } from "./remote";

const KEY = "k3y-for-the-remote-tests";

describe("remote routes", () => {
  let server: ServerService;
  let remote: RemoteSettings;
  let labels: RemoteLabels;

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
        paused: () => controlsService.isPaused(),
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
    expect(await res.json()).toEqual({ paused: true });
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
    const status = () => doc().getElementById("status")!.textContent;
    const button = (action: string) =>
      doc().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

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
            return fetch(new URL(path, page), init);
          };
        },
      });
    };

    afterEach(() => {
      dom?.window.close();
    });

    it("sends the key from the link, and never stores it", async () => {
      setup();

      await open(`#key=${encodeURIComponent(KEY)}`);
      await vi.waitFor(() => expect(button("pause").disabled).toBe(false));

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

      expect(button("skip-song").textContent).toBe("Skip <b>now</b>");
      expect(button("skip-song").children).toHaveLength(0);
      expect(doc().title).toBe("<i>T");
      expect(doc().querySelector("h1")!.textContent).toBe("<i>T");
    });

    it("says a link without a key won't work", async () => {
      setup();

      await open("");

      expect(status()).toBe(labels.text.noKey);
      expect(button("pause").disabled).toBe(true);
      expect(requests).toEqual([]);
    });

    it("says when the link no longer works", async () => {
      setup();

      await open("#key=old");

      await vi.waitFor(() => expect(status()).toBe(labels.text.newLink));
      expect(button("pause").disabled).toBe(true);
    });

    it("says when remote control is off", async () => {
      setup();
      remote = { ...remote, enabled: false };

      await open(`#key=${KEY}`);

      await vi.waitFor(() => expect(status()).toBe(labels.text.off));
    });

    it("pauses and resumes, showing the paused state", async () => {
      const { controlsService } = setup();
      await open(`#key=${KEY}`);
      const pause = button("pause");
      await vi.waitFor(() => expect(pause.disabled).toBe(false));
      expect(pause.textContent).toBe(labels.text.pause);
      expect(doc().getElementById("paused")!.hidden).toBe(true);

      pause.click();

      await vi.waitFor(() =>
        expect(pause.textContent).toBe(labels.text.resume),
      );
      expect(controlsService.isPaused()).toBe(true);
      expect(pause.getAttribute("aria-pressed")).toBe("true");
      expect(doc().body.classList.contains("paused")).toBe(true);
      expect(doc().getElementById("paused")!.hidden).toBe(false);
      expect(status()).toBe(labels.text.done);
      expect(requests.find((r) => r.init?.method === "POST")?.init?.body).toBe(
        JSON.stringify({ paused: true }),
      );

      // Paused elsewhere: the page follows the state it asks for
      controlsService.setPaused(false);
      dom.window.document.dispatchEvent(
        new dom.window.Event("visibilitychange"),
      );
      await vi.waitFor(() => expect(pause.textContent).toBe(labels.text.pause));
    });

    it("says when there's nothing to replay", async () => {
      setup();
      await open(`#key=${KEY}`);
      await vi.waitFor(() =>
        expect(button("replay-alert").disabled).toBe(false),
      );

      button("replay-alert").click();

      await vi.waitFor(() =>
        expect(status()).toBe(labels.text.nothingToReplay),
      );
    });

    it("says when it can't reach Tokio", async () => {
      setup();
      await open(`#key=${KEY}`);
      await vi.waitFor(() => expect(button("stop-tts").disabled).toBe(false));
      server.stop();

      button("stop-tts").click();

      await vi.waitFor(() => expect(status()).toBe(labels.text.unreachable));
    });
  });
});
