import { isLiveEvent, TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import { formatError, SERVER_PORT } from "@/common/util";
import Logger from "@/logger";
import express, { Express, Router } from "express";
import { randomUUID } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { TikTokConnectorService } from "../connector";
import { MusicService } from "../music";
import { Service } from "../shared";
import { CustomWebSocketServer } from "./websocket";

export class ServerService extends Service {
  private _app: Express;
  private _server: HttpServer | null = null;
  private _wss: CustomWebSocketServer | null = null;
  private _dynamicRouter: Router;
  private _port: number;
  // Folders served under /<id>/, keyed by id.
  private _routes = new Map<string, string>();

  // NOTE: Overlays connect to SERVER_PORT, other ports are for tests.
  constructor(port: number = SERVER_PORT) {
    super();
    this._app = express();
    this._dynamicRouter = express.Router();
    this._port = port;

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
      // Express 5 calls this with the error too, the "error" handler reports it.
      this._server = this._app.listen(this._port, (error) => {
        if (error) return;
        // Port 0 picks a free port.
        const address = this._server!.address();
        if (address && typeof address === "object") this._port = address.port;
        // Overlays only listen, so a big message is never one of theirs.
        this._wss = new CustomWebSocketServer({
          server: this._server!,
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

      this._server.on("error", (err) => {
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
