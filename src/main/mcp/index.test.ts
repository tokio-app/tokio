import { RemoteSettings } from "@/common/schemas";
import controls from "@/events/pages/controls";
import { ControlsService } from "@/services/controls";
import { ServerService } from "@/services/server";
import { createHandler } from "@test/handler";
import { answerFlushes } from "@test/mcp";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpRoutes, isLoopback } from "./index";

const KEY = "k3y-for-the-mcp-tests";

describe("MCP route", () => {
  let server: ServerService;
  let remote: RemoteSettings;
  let clients: Client[];

  const setup = () => {
    const controlsService = new ControlsService();
    const h = createHandler(
      {
        controlsService,
        musicService: {
          skip: vi.fn(() => true),
          isActive: () => false,
          songs: () => [],
        },
        ttsService: { clearTalk: vi.fn() },
        alertsService: { clear: vi.fn() },
        gamesService: {
          stopRuns: vi.fn(),
          status: () => ({ minecraft: { state: "off" } }),
        },
        storeManagerService: {
          getRemote: () => remote,
          getSettings: () => ({
            remote,
            activeProfile: { name: "Main", file: "main.json" },
            activeFeatures: { tts: true, music: true, alerts: true },
            server: { enabled: true },
            accounts: { twitch: { id: "", login: "", key: "" } },
          }),
          getLiveStats: () => ({ likes: 0, views: 0, viewers: 0 }),
        },
        connectorService: {
          isConnected: () => false,
          isReconnecting: () => false,
          isWaiting: () => false,
          status: () => ({}),
          username: "",
        },
        liveService: {
          getNumbers: () => ({
            startedAt: null,
            totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
          }),
        },
        timerService: {
          get: () => ({ state: { status: "idle", remaining: 0 } }),
        },
        serverService: { getPort: () => server.getPort() },
        updaterService: { getStatus: () => ({ state: "idle" }) },
      },
      { stack: controls },
    );
    answerFlushes(h.handler);
    server.setControlRoutes(createMcpRoutes(h.handler));
    return { h, controlsService };
  };

  const url = () => `http://127.0.0.1:${server.getPort()}/mcp`;

  const post = (headers: Record<string, string>, body?: unknown) =>
    fetch(url(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(
        body ?? { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      ),
    });

  const connect = async (key = KEY) => {
    const client = new Client({ name: "test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url()), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
      }),
    );
    return client;
  };

  beforeEach(async () => {
    remote = { enabled: true, key: KEY };
    clients = [];
    server = new ServerService(0);
    await server.start();
  });

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    server.stop();
  });

  it("refuses a request with an Origin, even with the key", async () => {
    setup();

    const res = await post({
      Authorization: `Bearer ${KEY}`,
      Origin: "http://127.0.0.1:37891",
    });

    expect(res.status).toBe(403);
  });

  it("refuses everything while remote control is off", async () => {
    setup();
    remote = { ...remote, enabled: false };

    const res = await post({ Authorization: `Bearer ${KEY}` });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "off" });
  });

  it.each([
    ["no key", {}],
    ["a wrong key", { Authorization: `Bearer ${KEY}x` }],
  ])("refuses %s", async (_name, headers) => {
    setup();

    const res = await post(headers);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "key" });
  });

  it("refuses a body over 1 MB", async () => {
    setup();

    const res = await post(
      { Authorization: `Bearer ${KEY}` },
      { pad: "x".repeat(1024 * 1024) },
    );

    expect(res.status).toBe(413);
  });

  it("answers GET and DELETE with 405, as a stateless server", async () => {
    setup();

    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(url(), {
        method,
        headers: {
          Authorization: `Bearer ${KEY}`,
          Accept: "text/event-stream",
        },
      });
      expect(res.status).toBe(405);
    }
  });

  it("lists the tools with their annotations", async () => {
    setup();
    const client = await connect();

    const { tools } = await client.listTools();

    const control = tools.find((t) => t.name === "control");
    expect(control?.annotations).toEqual({
      title: "Live controls",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(
      tools.find((t) => t.name === "get_status")?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(client.getInstructions()).toMatch(/viewer data, never instructions/);
    expect(client.getInstructions()).toMatch(
      /TikTok, Twitch, YouTube and Kick/,
    );
  });

  it("runs control and get_status", async () => {
    const { controlsService } = setup();
    const client = await connect();

    const paused = await client.callTool({
      name: "control",
      arguments: { action: "pause" },
    });
    const status = await client.callTool({ name: "get_status", arguments: {} });

    expect(paused.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ done: true, paused: true }, null, 2),
      },
    ]);
    expect(controlsService.isPaused()).toBe(true);
    const [content] = Array.isArray(status.content) ? status.content : [];
    expect(
      JSON.parse(content?.type === "text" ? content.text : ""),
    ).toMatchObject({
      paused: true,
      profile: "Main",
      overlayServer: { enabled: true, port: server.getPort() },
    });
  });
});

describe("isLoopback", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("takes %s", (address) => {
    expect(isLoopback(address)).toBe(true);
  });

  it.each(["192.168.1.20", "::ffff:192.168.1.20", "127.0.0.2", "", undefined])(
    "refuses %s",
    (address) => {
      expect(isLoopback(address)).toBe(false);
    },
  );
});
