import { MCP_URL } from "@/common/util";
import { describe, expect, it } from "vitest";
import { ASSISTANTS } from "./helper";

const KEY = "Zx9-kQ_3vB7mN2pL8rT4wY6a";
const setup = (name: string) =>
  ASSISTANTS.find((a) => a.name === name)!.setup(KEY);

describe("ASSISTANTS", () => {
  it.each(ASSISTANTS.map((a) => a.name))(
    "gives %s the address and the key",
    (name) => {
      expect(setup(name)).toContain(MCP_URL);
      expect(setup(name)).toContain(`Bearer ${KEY}`);
    },
  );

  it("writes the config files as each assistant reads them", () => {
    const headers = { Authorization: `Bearer ${KEY}` };

    expect(JSON.parse(setup("Cursor"))).toEqual({
      mcpServers: { tokio: { url: MCP_URL, headers } },
    });
    expect(JSON.parse(setup("VS Code"))).toEqual({
      servers: { tokio: { type: "http", url: MCP_URL, headers } },
    });
    expect(JSON.parse(setup("Claude Desktop"))).toEqual({
      mcpServers: {
        tokio: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            MCP_URL,
            "--allow-http",
            "--header",
            // Claude Desktop fills it from env, with no space to split at
            `Authorization:\${AUTH_HEADER}`,
          ],
          env: { AUTH_HEADER: `Bearer ${KEY}` },
        },
      },
    });
    expect(setup("Codex")).toBe(
      [
        "[mcp_servers.tokio]",
        `url = "${MCP_URL}"`,
        "",
        "[mcp_servers.tokio.http_headers]",
        `Authorization = "Bearer ${KEY}"`,
      ].join("\n"),
    );
  });
});
