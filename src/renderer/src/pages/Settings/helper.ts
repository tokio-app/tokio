import type { MessageKey } from "@/common/i18n";
import { MCP_URL } from "@/common/util";

/**
 * An AI assistant Remote control shows the setup for, key included. The
 * website's MCP page shows the same setups: change them together.
 */
export interface Assistant {
  name: string;
  // A command, or a config to paste, with the key in it
  setup: (key: string) => string;
  // Where it goes, as a sentence that may name the file
  where: MessageKey;
  file?: string;
}

// Keys are URL-safe base64, which the commands can quote as they are
const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

// One value per line, so a long key doesn't wrap a line in the middle
const json = (config: object) => JSON.stringify(config, null, 2);

export const ASSISTANTS: Assistant[] = [
  {
    name: "Claude Code",
    setup: (key) =>
      `claude mcp add --transport http tokio ${MCP_URL} --header "Authorization: Bearer ${key}"`,
    where: "settings.remote.inTerminal",
  },
  {
    name: "Codex",
    // A JSON string is a TOML basic string too
    setup: (key) =>
      [
        "[mcp_servers.tokio]",
        `url = "${MCP_URL}"`,
        "",
        "[mcp_servers.tokio.http_headers]",
        `Authorization = ${JSON.stringify(auth(key).Authorization)}`,
      ].join("\n"),
    where: "settings.remote.inFile",
    file: "~/.codex/config.toml",
  },
  {
    name: "Gemini CLI",
    // The user's settings, so it works in every folder
    setup: (key) =>
      `gemini mcp add --scope user --transport http --header "Authorization: Bearer ${key}" tokio ${MCP_URL}`,
    where: "settings.remote.inTerminal",
  },
  {
    name: "Cursor",
    setup: (key) =>
      json({ mcpServers: { tokio: { url: MCP_URL, headers: auth(key) } } }),
    where: "settings.remote.inFile",
    file: "~/.cursor/mcp.json",
  },
  {
    name: "VS Code",
    setup: (key) =>
      json({
        servers: { tokio: { type: "http", url: MCP_URL, headers: auth(key) } },
      }),
    where: "settings.remote.inVsCode",
  },
  {
    // It starts MCP servers as programs, so it reaches Tokio through
    // mcp-remote. No space after "Authorization:": on Windows, Claude
    // Desktop splits arguments at spaces.
    name: "Claude Desktop",
    setup: (key) =>
      json({
        mcpServers: {
          tokio: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              MCP_URL,
              "--allow-http",
              "--header",
              // Filled from env by Claude Desktop
              `Authorization:\${AUTH_HEADER}`,
            ],
            env: { AUTH_HEADER: auth(key).Authorization },
          },
        },
      }),
    where: "settings.remote.inClaudeDesktop",
  },
];
