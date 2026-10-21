import { APP_HOSTNAME, SERVER_PORT } from "@/common/util";
import { CSP } from "./csp";

export default {
  CSP,
  CMD: {
    HOST:
      process.platform === "win32"
        ? [
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "drivers",
            "etc",
            "hosts",
          ]
        : ["/etc", "hosts"],
    IP: "127.0.0.1",
    IP6: "::1",
    FQDN: APP_HOSTNAME,
    NAME: "Tokio",
  },
  DB: {
    name: "tokio",
  },
  APP: {
    folderName: ".tokio",
  },
  URL_FILTER: {
    urls: [
      `ws://localhost:${SERVER_PORT}/*`,
      `ws://127.0.0.1:${SERVER_PORT}/*`,
      `wss://localhost:${SERVER_PORT}/*`,
      `wss://127.0.0.1:${SERVER_PORT}/*`,
      `ws://[::1]:${SERVER_PORT}/*`,
      `wss://[::1]:${SERVER_PORT}/*`,
      `ws://${APP_HOSTNAME}:${SERVER_PORT}/*`,
      `wss://${APP_HOSTNAME}:${SERVER_PORT}/*`,
    ],
  },
};
