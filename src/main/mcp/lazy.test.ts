import { ServerService } from "@/services/server";
import { createHandler } from "@test/handler";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMcpRoutes } from "./index";

// Each counts when its module is first imported. Apart from the other MCP
// tests: their helpers import the tools themselves.
const loads = vi.hoisted(() => ({ sdk: 0, tools: 0 }));
vi.mock("@modelcontextprotocol/server", async (importOriginal) => {
  loads.sdk++;
  return importOriginal();
});
vi.mock("./registry", async (importOriginal) => {
  loads.tools++;
  return importOriginal();
});

const KEY = "k3y-for-the-lazy-test";
let server: ServerService;

beforeEach(async () => {
  server = new ServerService(0);
  await server.start();
});

afterEach(() => {
  server.stop();
});

const post = (key: string) =>
  fetch(`http://127.0.0.1:${server.getPort()}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });

it("loads the SDK and the tools with the first request past the checks", async () => {
  const h = createHandler({
    storeManagerService: {
      getSettings: () => ({ remote: { enabled: true, key: KEY } }),
    },
  });
  server.setControlRoutes(createMcpRoutes(h.handler));
  expect(loads).toEqual({ sdk: 0, tools: 0 });

  expect((await post("wrong")).status).toBe(401);
  expect(loads).toEqual({ sdk: 0, tools: 0 });

  expect((await post(KEY)).status).toBe(200);
  expect((await post(KEY)).status).toBe(200);
  expect(loads).toEqual({ sdk: 1, tools: 1 });
});
