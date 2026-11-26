import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import defaults from "../config";
import { isTerminal, KickSocket, type KickSocketHandlers } from "./socket";

const FEEDS = ["chatrooms.20.v2", "chatroom_20", "channel.10", "channel_10"];

type Command = { id: number; [key: string]: any };

// Stands in for Kick's Centrifugo server: answers connect and subscribes as
// the real one does, unless a test answers instead
describe("KickSocket", () => {
  let server: WebSocketServer;
  let url: string;
  let clients: { ws: WebSocket; req: IncomingMessage; got: Command[] }[];
  let answer: (command: Command) => object | null;
  let handlers: {
    [K in keyof KickSocketHandlers]: Mock<KickSocketHandlers[K]>;
  };
  let socket: KickSocket;

  const client = () => clients[clients.length - 1];
  const make = (options: Partial<typeof defaults> = {}) =>
    new KickSocket(
      { ...defaults, USER_AGENT: "Tokio/test", PING_GRACE_MS: 0, ...options },
      handlers,
    );

  beforeEach(async () => {
    clients = [];
    answer = (command) =>
      command.connect
        ? { id: command.id, connect: { ttl: 2700, ping: 25, pong: true } }
        : { id: command.id, [Object.keys(command)[1]]: {} };
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    url = `ws://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/connection/websocket`;
    server.on("connection", (ws, req) => {
      const entry = { ws, req, got: [] as Command[] };
      clients.push(entry);
      ws.on("message", (raw: Buffer) => {
        const text = raw.toString();
        if (text === "{}") {
          entry.got.push({ id: 0, pong: true });
          return;
        }
        const command: Command = JSON.parse(text);
        entry.got.push(command);
        const reply = answer(command);
        if (reply) ws.send(JSON.stringify(reply));
      });
    });
    handlers = {
      publication: vi.fn(),
      drop: vi.fn(),
      token: vi.fn(async () => "token-2"),
      log: vi.fn(),
      warn: vi.fn(),
    };
    socket = make();
  });

  afterEach(async () => {
    socket.close();
    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  it("connects from kick.com's origin with the token, then subscribes", async () => {
    await socket.open(url, "token-1", FEEDS);

    expect(socket.connected).toBe(true);
    expect(client().req.headers.origin).toBe("https://kick.com");
    expect(client().req.headers["user-agent"]).toBe("Tokio/test");
    expect(client().got).toEqual([
      { id: 1, connect: { token: "token-1", name: "js" } },
      ...FEEDS.map((channel, i) => ({ id: i + 2, subscribe: { channel } })),
    ]);
  });

  it("reads several replies in one frame, and answers pings", async () => {
    answer = () => null;
    const opening = socket.open(url, "token-1", FEEDS);
    await vi.waitFor(() => expect(client()?.got).toHaveLength(5));

    client().ws.send(
      [
        JSON.stringify({ id: 1, connect: { ttl: 2700, ping: 25 } }),
        ...[2, 3, 4, 5].map((id) => JSON.stringify({ id, subscribe: {} })),
      ].join("\n"),
    );
    await opening;
    client().ws.send("{}");

    await vi.waitFor(() =>
      expect(client().got.at(-1)).toEqual({ id: 0, pong: true }),
    );
  });

  it("decodes publications, their data a string or an object", async () => {
    await socket.open(url, "token-1", FEEDS);
    const push = (data: unknown) =>
      JSON.stringify({
        push: {
          channel: "channel.10",
          pub: { data: { event: "App\\Events\\StreamerIsLive", data } },
        },
      });

    client().ws.send(
      `${push(JSON.stringify({ livestream: { id: 1 } }))}\n${push({ livestream: { id: 2 } })}`,
    );

    await vi.waitFor(() =>
      expect(handlers.publication).toHaveBeenCalledTimes(2),
    );
    expect(handlers.publication.mock.calls).toEqual([
      ["channel.10", "App\\Events\\StreamerIsLive", { livestream: { id: 1 } }],
      ["channel.10", "App\\Events\\StreamerIsLive", { livestream: { id: 2 } }],
    ]);
  });

  it("warns when a publication's handler throws, and keeps reading", async () => {
    handlers.publication.mockImplementationOnce(() => {
      throw new Error("bad event");
    });
    await socket.open(url, "token-1", FEEDS);
    const push = (id: number) =>
      JSON.stringify({
        push: {
          channel: "channel.10",
          pub: { data: { event: "StreamerIsLive", data: { id } } },
        },
      });

    client().ws.send(`${push(1)}\n${push(2)}`);

    await vi.waitFor(() =>
      expect(handlers.publication).toHaveBeenCalledTimes(2),
    );
    expect(handlers.warn).toHaveBeenCalledWith(
      expect.stringContaining("bad event"),
    );
  });

  it("sends a new token before the last one lapses", async () => {
    answer = (command) =>
      command.connect
        ? { id: command.id, connect: { ttl: 0.1, ping: 25 } }
        : command.refresh
          ? { id: command.id, refresh: { ttl: 2700 } }
          : { id: command.id, subscribe: {} };
    await socket.open(url, "token-1", FEEDS);

    await vi.waitFor(() =>
      expect(client().got.at(-1)).toEqual({
        id: 6,
        refresh: { token: "token-2" },
      }),
    );
    expect(handlers.drop).not.toHaveBeenCalled();
  });

  it("drops when the server stops pinging", async () => {
    answer = (command) =>
      command.connect
        ? { id: command.id, connect: { ttl: 2700, ping: 0.05 } }
        : { id: command.id, subscribe: {} };
    await socket.open(url, "token-1", FEEDS);

    await vi.waitFor(() =>
      expect(handlers.drop).toHaveBeenCalledWith(
        "no message for 0.05 s",
        false,
      ),
    );
    expect(socket.connected).toBe(false);
  });

  it("tells a reconnecting close from a terminal one", async () => {
    await socket.open(url, "token-1", FEEDS);
    client().ws.close(4005, "network timeout");
    await vi.waitFor(() =>
      expect(handlers.drop).toHaveBeenCalledWith(
        "closed (4005 network timeout)",
        false,
      ),
    );

    await socket.open(url, "token-1", FEEDS);
    client().ws.send(
      JSON.stringify({
        push: { disconnect: { code: 3501, reason: "bad request" } },
      }),
    );
    await vi.waitFor(() =>
      expect(handlers.drop).toHaveBeenLastCalledWith(
        "disconnected (3501 bad request)",
        true,
      ),
    );
  });

  it("fails an open on a close, terminal or not", async () => {
    answer = () => null;
    const opening = socket.open(url, "token-1", FEEDS);
    await vi.waitFor(() => expect(client()?.got).toHaveLength(5));
    client().ws.close(4501, "nope");

    const error = await opening.catch((err: unknown) => err);
    expect(error).toMatchObject({ kind: "network" });
    expect(isTerminal(error)).toBe(true);
    expect(handlers.drop).not.toHaveBeenCalled();
  });

  it("leaves a refused feed out, but not chat's", async () => {
    answer = (command) =>
      command.connect
        ? { id: command.id, connect: { ttl: 2700, ping: 25 } }
        : command.subscribe.channel === "channel_10"
          ? {
              id: command.id,
              error: { code: 103, message: "permission denied" },
            }
          : { id: command.id, subscribe: {} };
    await socket.open(url, "token-1", FEEDS);
    expect(handlers.warn).toHaveBeenCalledWith(
      "Kick refused channel_10 (103 permission denied): its events are left out.",
    );

    const refused = await socket
      .open(url, "token-1", ["channel_10", ...FEEDS])
      .catch((err: unknown) => err);
    expect(refused).toMatchObject({ kind: "unknown" });
    expect(isTerminal(refused)).toBe(false);
  });

  it("fails on a refused token, terminal unless it expired", async () => {
    answer = (command) =>
      command.connect
        ? { id: command.id, error: { code: 109, message: "token expired" } }
        : null;
    const expired = await socket
      .open(url, "token-1", FEEDS)
      .catch((err: unknown) => err);
    expect(isTerminal(expired)).toBe(false);

    answer = (command) =>
      command.connect
        ? { id: command.id, error: { code: 101, message: "unauthorized" } }
        : null;
    const refused = await socket
      .open(url, "token-1", FEEDS)
      .catch((err: unknown) => err);
    expect(isTerminal(refused)).toBe(true);
  });
});
