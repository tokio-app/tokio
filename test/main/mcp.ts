import { APP_EVENTS_RESPONSE } from "@/common/types";
import { settingsFlushed } from "@/mcp/common";
import type { Registry } from "@/mcp/defs";
import { createMcpServer } from "@/mcp/registry";
import type { AppHandlerVariables } from "@/types";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach } from "vitest";
import { FakeWebContents } from "./electron";

const open: Client[] = [];
// The fake records channels as strings
const FLUSH: string = APP_EVENTS_RESPONSE.FLUSH_SETTINGS;

afterEach(async () => {
  await Promise.all(open.splice(0).map((client) => client.close()));
});

/**
 * Makes the fake window answer FLUSH_SETTINGS at once, as the app's does,
 * so writes don't wait FLUSH_MS. pushed(FLUSH_SETTINGS) still lists them.
 */
export function answerFlushes(handler: AppHandlerVariables) {
  const contents: unknown = handler.win.webContents;
  if (contents instanceof FakeWebContents) {
    contents.send.mockImplementation((channel, data) => {
      if (channel !== FLUSH) return;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- its payload
      queueMicrotask(() => settingsFlushed((data as { id: string }).id));
    });
  }
}

/**
 * A client connected in memory to the MCP server `createMcpServer` builds on
 * `handler` (from createHandler) and `registry`, every area's by default.
 * `call` runs a tool and gives its text, parsed as JSON when it is.
 */
export async function mcpClient(
  handler: AppHandlerVariables,
  registry?: Registry,
) {
  answerFlushes(handler);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(handler, registry).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  open.push(client);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const content = Array.isArray(res.content) ? res.content : [];
    const text = content.map((c) => (c.type === "text" ? c.text : "")).join("");
    let value: unknown = text;
    try {
      value = JSON.parse(text);
    } catch {
      // A sentence
    }
    return { isError: res.isError === true, text, value };
  };

  return { client, call };
}
