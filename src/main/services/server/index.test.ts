import { TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import Logger from "@/logger";
import { JSDOM } from "jsdom";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { NetworkInterfaceInfo, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { TikTokConnectorService } from "../connector";
import { ConnectorProvider } from "../connector/common";
import { MusicService } from "../music";
import { ServerService } from "./index";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) };
});

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

// An address of this PC another computer could reach, if it has one
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((iface) => iface?.family === "IPv4" && !iface.internal)?.address;

const iface = (
  address: string,
  family: "IPv4" | "IPv6" = "IPv4",
): NetworkInterfaceInfo => {
  const info = {
    address,
    internal: address === "127.0.0.1" || address === "::1",
    netmask: "255.255.255.0",
    mac: "00:00:00:00:00:00",
    cidr: null,
  };
  return family === "IPv4"
    ? { ...info, family }
    : { ...info, family, scopeid: 0 };
};

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
    // Turning it on while it runs keeps it running.
    expect(await server.toggleServer(true)).toBe(true);
    expect((await fetch(`http://127.0.0.1:${server.getPort()}/`)).status).toBe(
      404,
    );

    expect(await server.toggleServer(false)).toBe(true);
    expect(await server.toggleServer(true)).toBe(true);
  });

  it.skipIf(!hasIPv6Loopback)("accepts IPv6 connections too", async () => {
    await server.start();

    const res = await fetch(`http://[::1]:${server.getPort()}/`);

    expect(res.status).toBe(404);
  });

  it("listens on every interface, for streaming apps on another computer", async () => {
    await server.start();

    const address = server["_server"]!.address();

    expect(address).toMatchObject({
      address: expect.stringMatching(/^(::|0\.0\.0\.0)$/),
    });
  });

  it.skipIf(!lanAddress)(
    "accepts connections to its network address",
    async () => {
      await server.start();

      const res = await fetch(`http://${lanAddress}:${server.getPort()}/`);

      expect(res.status).toBe(404);
    },
  );

  it("lists this PC's network addresses, leaving out virtual adapters", () => {
    vi.mocked(networkInterfaces).mockReturnValueOnce({
      "vEthernet (WSL)": [iface("172.20.0.1")],
      lo: [iface("127.0.0.1"), iface("::1", "IPv6")],
      "Wi-Fi": [
        iface("fe80::1", "IPv6"),
        iface("192.168.1.10"),
        iface("169.254.3.4"),
      ],
      docker0: [iface("172.17.0.1")],
      "VMware Network Adapter VMnet8": [iface("192.168.174.1")],
      Ethernet: [iface("10.0.0.5")],
    });

    expect(server.networkAddresses()).toEqual(["192.168.1.10", "10.0.0.5"]);
  });

  it("lists virtual adapters' addresses when there's no other, as with a Hyper-V switch", () => {
    vi.mocked(networkInterfaces).mockReturnValueOnce({
      lo: [iface("127.0.0.1")],
      "vEthernet (External)": [iface("192.168.1.20")],
      "vEthernet (WSL)": [iface("172.20.0.1")],
    });

    expect(server.networkAddresses()).toEqual(["192.168.1.20", "172.20.0.1"]);
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

  describe("alert overlays", () => {
    beforeEach(async () => {
      const media = join(dir, "media");
      await mkdir(media);
      await writeFile(join(media, "a.webm"), "0123456789");
      server.mount("alerts/media", media);
      await server.start();
    });

    it("serves the alert page at any alert's id", async () => {
      for (const path of ["/alerts/abc/", "/alerts/abc"]) {
        const res = await fetch(url(path));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/html/);
        expect(await res.text()).toContain("tokio:alert:media");
      }
    });

    it("serves the alerts' media in parts, as videos ask", async () => {
      const res = await fetch(url("/alerts/media/a.webm"), {
        headers: { Range: "bytes=2-4" },
      });

      expect(res.status).toBe(206);
      expect(await res.text()).toBe("234");
    });

    it("shows the media sent to its alert, one at a time, until cleared", async () => {
      const page = url("/alerts/abc/");
      const dom = new JSDOM(await (await fetch(page)).text(), {
        url: page,
        runScripts: "dangerously",
        beforeParse(window) {
          // jsdom doesn't play media.
          window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        },
      });
      const { document } = dom.window;
      const shown = () =>
        [...document.querySelectorAll("img, video")].map((el) => el.src);
      const show = (file: string, kind: string) =>
        server.sendToClient("abc", {
          type: "tokio:alert:media",
          data: {
            src: `/alerts/media/${file}`,
            kind,
            duration: 60,
            volume: 50,
          },
        });

      try {
        // Its socket connects with the alert's id from its URL.
        await vi.waitFor(() =>
          expect(server.sendToClient("abc", {})).toBe(true),
        );

        show("a.png", "image");
        await vi.waitFor(() =>
          expect(shown()).toEqual([url("/alerts/media/a.png")]),
        );

        server.sendToClient("abc", { type: TOKIO_EVENTS.FOLLOW, data: follow });
        show("a.webm", "video");
        await vi.waitFor(() =>
          expect(shown()).toEqual([url("/alerts/media/a.webm")]),
        );
        expect(document.querySelector("video").volume).toBe(0.5);

        server.sendToClient("abc", { type: "tokio:alert:clear" });
        await vi.waitFor(() => expect(shown()).toEqual([]));
      } finally {
        dom.window.close();
      }
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

      provider.emit(TOKIO_EVENTS.CONNECTED, undefined);
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

    it("survives a malformed upgrade target and a bad frame", async () => {
      const warn = vi.spyOn(Logger, "warn");
      const socket = createConnection(server.getPort(), "127.0.0.1");
      const upgraded = new Promise((resolve) => socket.once("data", resolve));
      const closed = new Promise((resolve) => socket.once("close", resolve));

      socket.write(
        [
          "GET http://[ HTTP/1.1",
          "Host: 127.0.0.1",
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
      await upgraded;
      // Clients must mask their frames, so ws refuses this one.
      socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
      await closed;

      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/^<WebSocket> Client .+ error -- /),
        undefined,
      );
      await expect(connect("a")).resolves.toBeInstanceOf(WebSocket);
    });

    it("reports a send to an id with no overlay connected", () => {
      expect(server.sendToClient("missing", "ping")).toBe(false);
    });
  });
});
