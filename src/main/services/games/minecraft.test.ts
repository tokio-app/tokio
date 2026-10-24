import { CommandResult, GameStatus } from "@/common/types";
import {
  Cipheriv,
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  Decipheriv,
} from "node:crypto";
import { once } from "node:events";
import { createServer, Server, Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { MinecraftConnection } from "./minecraft";

const SPKI_PREFIX = Buffer.from(
  "3076301006072a8648ce3d020106052b81040022036200",
  "hex",
);
const WSENCRYPT = "com.microsoft.minecraft.wsencrypt";

type Request = {
  requestId: string;
  commandLine: string;
  version: number;
  binary: boolean;
};
type Body = Record<string, unknown>;

const connections: MinecraftConnection[] = [];
const sockets: WebSocket[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(connections.splice(0).map((c) => c.setEnabled(false)));
  for (const server of servers.splice(0)) server.close();
});

async function listen(options?: { timeoutMs?: number; handshakeMs?: number }) {
  const connection = new MinecraftConnection(0, options);
  connections.push(connection);
  const statuses: GameStatus[] = [];
  connection.onStatus((status) => statuses.push(status));
  expect(await connection.setEnabled(true)).toBe(true);
  return { connection, statuses };
}

/**
 * Plays the game: answers the encryption request with its three frames, then
 * answers each command with `reply` (null holds the answer).
 */
async function game(
  port: number,
  { encrypt = true }: { encrypt?: boolean } = {},
) {
  // The game offers this subprotocol when it requires encryption
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}//`,
    encrypt ? [WSENCRYPT] : [],
  );
  sockets.push(socket);
  let cipher: Cipheriv | undefined;
  let decipher: Decipheriv | undefined;
  const requests: Request[] = [];

  const fake = {
    socket,
    requests,
    reply: (request: Request): Body | null => ({
      statusCode: 0,
      statusMessage: `Ran ${request.commandLine}`,
    }),
    send(frame: object, plain = false) {
      const json = JSON.stringify(frame);
      socket.send(cipher && !plain ? cipher.update(json, "utf8") : json);
    },
    respond(request: Request, body: Body, purpose = "commandResponse") {
      fake.send({
        header: { messagePurpose: purpose, requestId: request.requestId },
        body,
      });
    },
  };

  socket.on("message", (data: Buffer, isBinary) => {
    const plain = isBinary && decipher ? decipher.update(data) : data;
    const { header, body } = JSON.parse(plain.toString("utf8"));
    const handshake = /^enableencryption "(.+)" "(.+)" cfb$/.exec(
      body.commandLine,
    );
    if (handshake) {
      if (encrypt)
        answerHandshake(header.requestId, handshake[1], handshake[2]);
      return;
    }
    const request = {
      requestId: header.requestId,
      commandLine: body.commandLine,
      version: body.version,
      binary: isBinary,
    };
    requests.push(request);
    const answer = fake.reply(request);
    if (answer) fake.respond(request, answer);
  });

  function answerHandshake(requestId: string, theirs: string, salt: string) {
    const ecdh = createECDH("secp384r1");
    const publicKey = Buffer.concat([SPKI_PREFIX, ecdh.generateKeys()]);
    const secret = ecdh.computeSecret(
      Buffer.from(theirs, "base64").subarray(SPKI_PREFIX.length),
    );
    const key = createHash("sha256")
      .update(Buffer.from(salt, "base64"))
      .update(secret)
      .digest();
    const header = { requestId, version: 17104896 };
    const body = { publicKey: publicKey.toString("base64") };

    // Corked, the three frames leave in one TCP chunk, as the game sends them
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ws keeps its TCP socket private
    const tcp = (socket as unknown as { _socket: Socket })._socket;
    tcp.cork();
    fake.send({ header: { ...header, messagePurpose: "ws:encrypt" }, body });
    fake.send({
      header: { ...header, messagePurpose: "commandResponse" },
      body,
    });
    cipher = createCipheriv("aes-256-cfb", key, key.subarray(0, 16));
    decipher = createDecipheriv("aes-256-cfb", key, key.subarray(0, 16));
    fake.send({
      header: { ...header, messagePurpose: "commandResponse" },
      body: { statusCode: 0 },
    });
    tcp.uncork();
  }

  await once(socket, "open");
  return fake;
}

async function connected(connection: MinecraftConnection) {
  await vi.waitFor(() => expect(connection.status.state).toBe("connected"));
}

describe("MinecraftConnection", () => {
  it("goes from off to waiting, connected, waiting and off", async () => {
    const { connection, statuses } = await listen();
    expect(await connection.setEnabled(true)).toBe(true);
    const { socket } = await game(connection.port);
    await connected(connection);
    socket.close();
    await vi.waitFor(() => expect(connection.status.state).toBe("waiting"));
    await connection.setEnabled(false);

    expect(statuses.map((s) => s.state)).toEqual([
      "waiting",
      "connected",
      "waiting",
      "off",
    ]);
  });

  it("sets up encryption on the game's frames that come together, then runs commands encrypted", async () => {
    const { connection } = await listen();
    const fake = await game(connection.port);
    await connected(connection);
    expect(fake.socket.protocol).toBe(WSENCRYPT);

    // A missed third frame would desync the stream and garble this answer
    expect(await connection.send("execute as @p at @s run say hi")).toEqual({
      command: "execute as @p at @s run say hi",
      ok: true,
      message: "Ran execute as @p at @s run say hi",
    });
    expect(fake.requests).toEqual([
      expect.objectContaining({ version: 42, binary: true }),
    ]);
  });

  it("runs commands as plain text when the game doesn't answer the encryption request", async () => {
    const { connection } = await listen({ handshakeMs: 20 });
    const fake = await game(connection.port, { encrypt: false });
    await connected(connection);

    expect((await connection.send("time set day")).ok).toBe(true);
    expect(fake.requests[0].binary).toBe(false);
  });

  it("maps the game's answers", async () => {
    const { connection } = await listen();
    const fake = await game(connection.port);
    await connected(connection);
    const answers: Record<string, Body | null> = {
      bad: { statusCode: -2147483648, statusMessage: "Syntax error" },
      say: { statusCode: 0, message: "hi" },
      execute: { statusCode: 0 },
    };
    fake.reply = (request) => {
      if (request.commandLine !== "busy") return answers[request.commandLine];
      // The in-flight limit's error comes as plain text, even when encrypted
      fake.send(
        {
          header: { messagePurpose: "error", requestId: request.requestId },
          body: { statusCode: -2147418109, statusMessage: "Too many commands" },
        },
        true,
      );
      return null;
    };

    const results = await Promise.all(
      ["bad", "say", "execute", "busy"].map((c) => connection.send(c)),
    );
    expect(results).toEqual<CommandResult[]>([
      { command: "bad", ok: false, message: "Syntax error" },
      { command: "say", ok: true, message: "hi" },
      { command: "execute", ok: true, message: "" },
      { command: "busy", ok: false, message: "Too many commands" },
    ]);
  });

  it("keeps 50 commands in flight, sends the rest in order, and refuses past 500 waiting", async () => {
    const { connection } = await listen();
    const fake = await game(connection.port);
    await connected(connection);
    fake.reply = () => null;

    const commands = Array.from({ length: 550 }, (_, i) => `say ${i}`);
    const results = commands.map((c) => connection.send(c));
    expect(await connection.send("say late")).toEqual({
      command: "say late",
      ok: false,
      message: "Too many commands are waiting.",
    });
    await vi.waitFor(() => expect(fake.requests).toHaveLength(50));

    fake.reply = (request) => ({
      statusCode: 0,
      statusMessage: request.commandLine,
    });
    for (const request of fake.requests.slice()) {
      fake.respond(request, {
        statusCode: 0,
        statusMessage: request.commandLine,
      });
    }
    const done = await Promise.all(results);
    expect(done.every((r) => r.ok)).toBe(true);
    expect(fake.requests.map((r) => r.commandLine)).toEqual(commands);
  });

  it("fails a command the game doesn't answer, and frees its place", async () => {
    const { connection } = await listen({ timeoutMs: 30 });
    const fake = await game(connection.port);
    await connected(connection);
    fake.reply = () => null;

    expect(await connection.send("say lost")).toEqual({
      command: "say lost",
      ok: false,
      message: "Minecraft didn't answer.",
    });
    fake.reply = () => ({ statusCode: 0 });
    expect((await connection.send("say next")).ok).toBe(true);
  });

  it("fails sent and waiting commands when the game leaves", async () => {
    const { connection } = await listen();
    const fake = await game(connection.port);
    await connected(connection);
    fake.reply = () => null;

    const results = Array.from({ length: 55 }, (_, i) =>
      connection.send(`say ${i}`),
    );
    await vi.waitFor(() => expect(fake.requests).toHaveLength(50));
    fake.socket.close();

    for (const result of await Promise.all(results)) {
      expect(result).toMatchObject({
        ok: false,
        message: "Minecraft disconnected.",
      });
    }
    expect(connection.status.state).toBe("waiting");
  });

  it("refuses commands with no game", async () => {
    const { connection } = await listen();
    expect(await connection.send("say hi")).toEqual({
      command: "say hi",
      ok: false,
      message: "Minecraft isn't connected.",
    });
  });

  it("replaces the game with a new connection", async () => {
    const { connection } = await listen();
    const first = await game(connection.port);
    await connected(connection);
    const closed = once(first.socket, "close");

    const second = await game(connection.port);
    await closed;
    await connected(connection);
    expect((await connection.send("say hi")).ok).toBe(true);
    expect(first.requests).toEqual([]);
    expect(second.requests).toHaveLength(1);
  });

  it("refuses connections that carry an Origin, as browsers send", async () => {
    const { connection } = await listen();
    const socket = new WebSocket(`ws://127.0.0.1:${connection.port}//`, {
      origin: "https://example.com",
    });
    sockets.push(socket);
    const [, response] = await once(socket, "unexpected-response");
    expect(response.statusCode).toBe(401);
    socket.on("error", () => {});
    expect(connection.status.state).toBe("waiting");
  });

  it("reports a port that's in use", async () => {
    // No host, like the game's port: on macOS a catch-all listen can share a
    // port with a 127.0.0.1 one.
    const server = createServer().listen(0);
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a TCP server");
    const { port } = address;

    const connection = new MinecraftConnection(port);
    connections.push(connection);
    expect(await connection.setEnabled(true)).toBe(false);
    expect(connection.status).toEqual({
      state: "error",
      error: `Port ${port} is in use.`,
    });
  });

  it("drops the game and its commands when turned off", async () => {
    const { connection } = await listen();
    const fake = await game(connection.port);
    await connected(connection);
    fake.reply = () => null;
    const port = connection.port;

    const result = connection.send("say hi");
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    const closed = once(fake.socket, "close");
    expect(await connection.setEnabled(false)).toBe(true);

    await closed;
    expect(await result).toMatchObject({ ok: false });
    expect(connection.status).toEqual({ state: "off" });
    // The port is free again
    const server = createServer().listen(port);
    servers.push(server);
    await once(server, "listening");
  });
});
