import { TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import Logger from "@/logger";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { TikTokConnectorService } from "../connector";
import { ConnectorProvider } from "../connector/common";
import { MusicService } from "../music";
import { ServerService } from "./index";

// The real music service drives BrowserWindows.
const musicEvents = vi.hoisted(
  () => new Map<string, (data: unknown) => void>(),
);
vi.mock("../music", () => ({
  MusicService: class {
    on(event: string, listener: (data: unknown) => void) {
      musicEvents.set(event, listener);
    }
  },
}));

class FakeConnector extends ConnectorProvider {
  private _events = new EventEmitter();
  setKey() {}
  on<T extends TOKIO_EVENTS>(
    event: T,
    listener: (d: TokioEventMap[T]) => void,
  ) {
    this._events.on(event, listener);
  }
  off<T extends TOKIO_EVENTS>(
    event: T,
    listener: (d: TokioEventMap[T]) => void,
  ) {
    this._events.off(event, listener);
  }
  emit<T extends TOKIO_EVENTS>(event: T, data: TokioEventMap[T]) {
    this._events.emit(event, data);
  }
  async connect() {
    return { success: true };
  }
  async disconnect() {}
  isConnected() {
    return true;
  }
  async fetchGifts() {
    return { success: true, data: [] };
  }
}

const follow = {
  user: { username: "Viewer", handle: "viewer", profilePictures: [] },
};

const hasIPv6Loopback = Object.values(networkInterfaces())
  .flat()
  .some((iface) => iface?.address === "::1");

describe("ServerService", () => {
  let server: ServerService;
  let dir: string;
  const clients: WebSocket[] = [];

  const url = (path: string) => `http://127.0.0.1:${server.getPort()}${path}`;

  const connect = async (id: string) => {
    const client = new WebSocket(
      `ws://127.0.0.1:${server.getPort()}/?id=${id}`,
    );
    clients.push(client);
    await new Promise((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    return client;
  };

  const nextMessage = (client: WebSocket) =>
    new Promise<unknown>((resolve) =>
      // The server only sends text, which ws hands over as one Buffer.
      client.once("message", (raw) =>
        resolve(Buffer.isBuffer(raw) ? JSON.parse(raw.toString()) : raw),
      ),
    );

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    server = new ServerService(0);
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.terminate());
    server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("starts once and stops", async () => {
    expect((await server.start()).success).toBe(true);
    expect(server.getPort()).toBeGreaterThan(0);
    expect(await server.start()).toEqual({
      success: false,
      message: "Server already running.",
    });

    expect(await server.toggleServer(false)).toBe(true);
    expect(await server.toggleServer(true)).toBe(true);
  });

  it.skipIf(!hasIPv6Loopback)("accepts IPv6 connections too", async () => {
    await server.start();

    const res = await fetch(`http://[::1]:${server.getPort()}/`);

    expect(res.status).toBe(404);
  });

  it("sends nothing while stopped", () => {
    expect(server.sendToClient("a", "ping")).toBe(false);
  });

  it("fails to start on a port in use", async () => {
    await server.start();
    const other = new ServerService(server.getPort());

    const res = await other.start();
    other.stop();

    expect(res.success).toBe(false);
  });

  describe("overlays", () => {
    beforeEach(async () => {
      const overlay = join(dir, "clock");
      await mkdir(overlay);
      await writeFile(join(overlay, "index.html"), "<h1>clock</h1>");
      server.mount("clock", overlay);
      await server.start();
    });

    it("serves an overlay's files under its id", async () => {
      const res = await fetch(url("/clock/"));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<h1>clock</h1>");
    });

    it("redirects to the trailing slash so relative paths work", async () => {
      const res = await fetch(url("/clock"), { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/clock/");
    });

    it("stops serving an unmounted overlay", async () => {
      server.unmount("clock");

      expect((await fetch(url("/clock/"))).status).toBe(404);
    });
  });

  describe("websocket", () => {
    let provider: FakeConnector;
    let connector: TikTokConnectorService;

    beforeEach(async () => {
      provider = new FakeConnector();
      connector = new TikTokConnectorService();
      connector.addProvider("Fake", provider, true);
      server.initEvents(connector, new MusicService());
      await server.start();
    });

    it("broadcasts live events to every overlay", async () => {
      const a = await connect("a");
      const b = await connect("b");
      const messages = Promise.all([nextMessage(a), nextMessage(b)]);

      provider.emit(TOKIO_EVENTS.FOLLOW, follow);

      expect(await messages).toEqual([
        { type: TOKIO_EVENTS.FOLLOW, data: follow },
        { type: TOKIO_EVENTS.FOLLOW, data: follow },
      ]);
    });

    it("broadcasts music changes", async () => {
      const client = await connect("a");
      const message = nextMessage(client);
      const songs = [
        { title: "Song", thumbnail: "", playing: true, played: false },
      ];

      musicEvents.get(TOKIO_EVENTS.MUSIC_CHANGE)?.(songs);

      expect(await message).toEqual({
        type: TOKIO_EVENTS.MUSIC_CHANGE,
        data: songs,
      });
    });

    it("sends to a single overlay by id", async () => {
      const a = await connect("a");
      const b = await connect("b");
      const onB = vi.fn();
      b.on("message", onB);

      const message = nextMessage(a);
      expect(server.sendToClient("a", { hello: "a" })).toBe(true);

      expect(await message).toEqual({ hello: "a" });
      expect(onB).not.toHaveBeenCalled();
    });

    it("sends to every overlay connected with the same id", async () => {
      const first = await connect("a");
      const second = await connect("a");
      const messages = Promise.all([nextMessage(first), nextMessage(second)]);

      expect(server.sendToClient("a", "ping")).toBe(true);

      expect(await messages).toEqual(["ping", "ping"]);
    });

    it("keeps sending to an overlay when another with its id disconnects", async () => {
      const info = vi.spyOn(Logger, "info");
      const first = await connect("a");
      const second = await connect("a");

      first.close();
      await vi.waitFor(() =>
        expect(info.mock.calls.map(([message]) => message)).toContain(
          "<WebSocket> Client disconnected: a",
        ),
      );
      const message = nextMessage(second);

      expect(server.sendToClient("a", "ping")).toBe(true);
      expect(await message).toBe("ping");
    });

    it("keeps internal events in the app", async () => {
      const client = await connect("a");
      const message = nextMessage(client);

      provider.emit(TOKIO_EVENTS.CONNECTED, { success: true });
      provider.emit(TOKIO_EVENTS.FOLLOW, follow);

      expect(await message).toEqual({
        type: TOKIO_EVENTS.FOLLOW,
        data: follow,
      });
      expect(musicEvents.has(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED)).toBe(false);
    });

    it("closes a client that sends too much, without crashing", async () => {
      const warn = vi.spyOn(Logger, "warn");
      const client = await connect("a");
      const closed = new Promise<number>((resolve) =>
        client.once("close", resolve),
      );

      client.send("x".repeat(64 * 1024 + 1));

      expect(await closed).toBe(1009);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/^<WebSocket> Client a error -- /),
        undefined,
      );
    });

    it("reports a send to an id with no overlay connected", () => {
      expect(server.sendToClient("missing", "ping")).toBe(false);
    });

    it("stops forwarding after cleanupEvents", async () => {
      const client = await connect("a");
      const onMessage = vi.fn();
      client.on("message", onMessage);

      server.cleanupEvents(connector);
      provider.emit(TOKIO_EVENTS.FOLLOW, follow);
      // Anything sent before this arrives first.
      const ping = nextMessage(client);
      server.sendToClient("a", "ping");
      await ping;

      expect(onMessage).toHaveBeenCalledOnce();
    });
  });
});
