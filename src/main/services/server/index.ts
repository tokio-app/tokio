import GAMES_STYLES from "@/common/games/overlay.css?raw";
import { isLiveEvent, TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import {
  ALERTS_PATH,
  formatError,
  MINECRAFT_OVERLAY_PATH,
  SERVER_PORT,
  TIMER_PATH,
} from "@/common/util";
import ARCHIVO from "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?inline";
import Logger from "@/logger";
import express, { Express, Router } from "express";
import { randomUUID } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import { TikTokConnectorService } from "../connector";
import { MusicService } from "../music";
import { Service } from "../shared";
import ALERT_PAGE from "./alert.html?raw";
import GAMES_HTML from "./games.html?raw";
import TIMER_HTML from "./timer.html?raw";
import { CustomWebSocketServer } from "./websocket";

// Inlined, so streaming apps on any computer get the app's typeface, without
// a font route (res.sendFile refuses the Linux AppImage's /tmp/.mount_ folder)
const TIMER_PAGE = TIMER_HTML.replace("__ARCHIVO__", () => ARCHIVO);
// With the look it shares with the Games page's preview
const GAMES_PAGE = GAMES_HTML.replace("__ARCHIVO__", () => ARCHIVO).replace(
  "/* __STYLES__ */",
  () => GAMES_STYLES,
);

// Adapter names that are usually virtual: Hyper-V, WSL, VMs, Docker, bridges.
// A real network card can have them too, with Hyper-V or a bridge set up.
const VIRTUAL_ADAPTER = /vethernet|wsl|virtualbox|vmware|docker|^br|virbr/i;

export class ServerService extends Service {
  private _app: Express;
  private _server: HttpServer | null = null;
  private _wss: CustomWebSocketServer | null = null;
  private _dynamicRouter: Router;
  private _port: number;
  // Folders served under /<id>/, keyed by id.
  private _routes = new Map<string, string>();
  private _connectListeners: ((id: string) => void)[] = [];

  // NOTE: Overlays connect to SERVER_PORT, other ports are for tests.
  constructor(port: number = SERVER_PORT) {
    super();
    this._app = express();
    this._dynamicRouter = express.Router();
    this._port = port;

    // Each alert's overlay, the same page: it reads the alert's id from its
    // path. Their media is mounted at /alerts/media/, a path one level deeper.
    this._app.get(`/${ALERTS_PATH}/:id`, (_req, res) => {
      res.type("html").send(ALERT_PAGE);
    });
    // The countdown timer's overlay. Express 5 matches /timer/ too.
    this._app.get(`/${TIMER_PATH}`, (_req, res) => {
      res.type("html").send(TIMER_PAGE);
    });
    // Minecraft's overlay, every column or one: the page reads its column
    // from its path. Other names there, like its pictures' folder, pass on.
    this._app.get(`/${MINECRAFT_OVERLAY_PATH}{/:column}`, (req, res, next) => {
      const { column } = req.params;
      if (column !== undefined && !/^\d+$/.test(column)) return next();
      res.type("html").send(GAMES_PAGE);
    });

    this._app.use((req, res, next) => {
      this._dynamicRouter(req, res, next);
    });
  }

  private rebuildRoutes() {
    const newRouter = express.Router();
    this._routes.forEach((path, id) => {
      const route = "/" + id;
      newRouter.use(route, (req, res, next) => {
        if (req.originalUrl === route) {
          return res.redirect(route + "/");
        }
        next();
      });
      newRouter.use(route, express.static(path));
    });
    this._dynamicRouter = newRouter;
  }

  public setLogFile(logFile: string) {
    this._logFile = logFile;
  }

  public getPort(): number {
    return this._port;
  }

  public start(): Promise<{ success: boolean; message: string }> {
    if (this._server)
      return Promise.resolve({
        success: false,
        message: "Server already running.",
      });

    return new Promise((resolve) => {
      // Without a host Node listens on :: for IPv4 and IPv6, or 0.0.0.0 without IPv6.
      // On every interface on purpose: a streaming app on another computer
      // opens overlays from this PC, through its network address.
      // Express 5 calls this with the error too, the "error" handler reports it.
      const server = this._app.listen(this._port, (error) => {
        if (error) return;
        // Port 0 picks a free port.
        const address = server.address();
        if (address && typeof address === "object") this._port = address.port;
        // Overlays only listen, so a big message is never one of theirs.
        this._wss = new CustomWebSocketServer({
          server,
          maxPayload: 64 * 1024,
        });
        this._wss.on("error", (err) =>
          Logger.warn(
            `<WebSocket> Server error -- ${formatError(err)}`,
            this._logFile,
          ),
        );
        this._wss.on("connection", (client, req) => {
          // Unhandled, a bad frame would throw in main. ws closes the socket.
          client.on("error", (err) =>
            Logger.warn(
              `<WebSocket> Client ${clientId} error -- ${formatError(err)}`,
              this._logFile,
            ),
          );
          // URL.parse, as a request target like "http://[" makes new URL throw.
          const url = URL.parse(req.url ?? "/", "http://localhost");
          const clientId = url?.searchParams.get("id") || randomUUID();

          this._wss?.addClient(clientId, client);
          Logger.info(
            `<WebSocket> New client connected: ${clientId}`,
            this._logFile,
          );
          for (const listener of this._connectListeners) listener(clientId);

          client.on("close", () => {
            this._wss?.removeClient(clientId, client);
            Logger.info(
              `<WebSocket> Client disconnected: ${clientId}`,
              this._logFile,
            );
          });
        });
        Logger.success(
          `<Server> Server running on port ${this._port}`,
          this._logFile,
        );
        this.rebuildRoutes();
        resolve({
          success: true,
          message: `Server running on port ${this._port}`,
        });
      });

      this._server = server;

      server.on("error", (err) => {
        // After listening (EMFILE on accept) it still runs, and stop() must reach it.
        if (server.listening) {
          Logger.error(
            `<Server> Server error -- ${formatError(err)}`,
            this._logFile,
            err,
          );
          return;
        }
        this._server = null;
        Logger.error(
          `<Server> Unable to start server on port ${this._port} -- ${formatError(err)}`,
          this._logFile,
          err,
        );
        resolve({ success: false, message: err.message });
      });
    });
  }

  public stop(): void {
    if (this._wss) {
      this._wss.closeAll();
      this._wss = null;
      Logger.info(`<WebSocket> WebSocket server stopped.`, this._logFile);
    }
    if (this._server) {
      this._server.close();
      this._server = null;
      Logger.info(`<Server> Server stopped.`, this._logFile);
    }
  }

  public async toggleServer(value: boolean): Promise<boolean> {
    // A running server already is what was asked for, not a failed start.
    if (value) return this._server !== null || (await this.start()).success;
    this.stop();
    return true;
  }

  /**
   * This PC's IPv4 addresses on the network, where another computer reaches
   * the server. Virtual adapters' only when there's no other, as with
   * a Hyper-V switch or a bridge on the network card.
   */
  public networkAddresses(): string[] {
    const found = Object.entries(networkInterfaces()).flatMap(
      ([name, addresses]) =>
        (addresses ?? [])
          .filter(
            (a) =>
              a.family === "IPv4" &&
              !a.internal &&
              // Self-assigned, when the network gave none
              !a.address.startsWith("169.254."),
          )
          .map((a) => ({
            address: a.address,
            virtual: VIRTUAL_ADAPTER.test(name),
          })),
    );
    const real = found.filter((a) => !a.virtual);
    return (real.length > 0 ? real : found).map((a) => a.address);
  }

  public mount(id: string, path: string, rebuild: boolean = true): void {
    this._routes.set(id, path);
    if (rebuild) this.rebuildRoutes();
  }

  public unmount(id: string): void {
    this._routes.delete(id);
    this.rebuildRoutes();
  }

  public initEvents(
    connectorService: TikTokConnectorService,
    musicService: MusicService,
  ) {
    if (!connectorService) {
      throw new Error("Connector service not defined.");
    }
    Object.values(TOKIO_EVENTS)
      .filter(isLiveEvent)
      .forEach((event: TOKIO_EVENTS) => {
        const handler = (data: TokioEventMap[TOKIO_EVENTS]) =>
          this.broadcast(event, data);
        connectorService.on(event, handler);
        musicService.on(event, handler);
      });
  }

  /** Calls the listener with each overlay's id as it connects. */
  public onConnect(listener: (id: string) => void) {
    this._connectListeners.push(listener);
  }

  // Whether an overlay connected with the id got the payload.
  public sendToClient(id: string, payload: any): boolean {
    return this._wss?.sendToClient(id, payload) ?? false;
  }

  private broadcast<T extends TOKIO_EVENTS>(type: T, data: TokioEventMap[T]) {
    if (this._wss) {
      this._wss.broadcast({ type, data });
    }
  }
}
