import GAMES_STYLES from "@/common/games/overlay.css?raw";
import STUDIO_STYLES from "@/common/studio/overlay.css?raw";
import STAGE from "@/common/studio/stage.ts?script";
import {
  STUDIO_CAMERA_MAX_LENGTH,
  STUDIO_CAMERA_QUALITIES,
} from "@/common/schemas";
import {
  CameraCapture,
  CameraChunk,
  isLiveEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  TokioPayload,
} from "@/common/types";
import {
  ALERTS_PATH,
  formatError,
  MINECRAFT_OVERLAY_PATH,
  SERVER_PORT,
  STUDIO_CAMERA_PATH,
  STUDIO_PATH,
  TIMER_PATH,
} from "@/common/util";
import ARCHIVO from "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?inline";
import Logger from "@/logger";
import express, { Express, Router } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import { z } from "zod";
import { TikTokConnectorService } from "../connector";
import { MusicService } from "../music";
import { Service } from "../shared";
import ALERT_PAGE from "./alert.html?raw";
import { CameraFeeds } from "./camera";
import GAMES_HTML from "./games.html?raw";
import STUDIO_HTML from "./studio.html?raw";
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

// With the look and the renderer it shares with Overlay Studio's editor
const STUDIO_PAGE = STUDIO_HTML.replace("__ARCHIVO__", () => ARCHIVO)
  .replace("/* __STYLES__ */", () => STUDIO_STYLES)
  .replace("/* __STAGE__ */", () => STAGE);

// What a camera stream's URL asks for, as studioCameraPath builds it
const CameraQuerySchema = z.object({
  device: z.string().max(STUDIO_CAMERA_MAX_LENGTH),
  label: z.string().max(STUDIO_CAMERA_MAX_LENGTH),
  quality: z.enum(STUDIO_CAMERA_QUALITIES),
});

type Cameras = { key: string; captures: CameraCapture[] };

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
  // In every camera stream's URL: the server is open to the whole network,
  // and a camera shouldn't be. New on each start, so pages that reconnect
  // load their streams again. Never saved or logged.
  private _cameraKey = randomUUID();
  private _cameras = new CameraFeeds();
  private _cameraListeners: ((cameras: Cameras) => void)[] = [];

  // NOTE: Overlays connect to SERVER_PORT, other ports are for tests.
  constructor(port: number = SERVER_PORT) {
    super();
    this._app = express();
    // NODE_ENV isn't set, and in development error pages show the stack.
    this._app.set("env", "production");
    this._dynamicRouter = express.Router();
    this._port = port;
    this._cameras.onChange(() => this._camerasChanged());

    // A camera's video, which a camera element fetches and decodes. A wrong
    // key is a plain 404. /studio/:id matches one segment, so it never takes
    // these.
    this._app.get(`/${STUDIO_CAMERA_PATH}/:key`, (req, res, next) => {
      const given = Buffer.from(req.params.key);
      const key = Buffer.from(this._cameraKey);
      if (given.length !== key.length || !timingSafeEqual(given, key)) {
        return next();
      }
      const query = CameraQuerySchema.safeParse(req.query);
      if (!query.success) return void res.sendStatus(400);
      const { device, label, quality } = query.data;
      this._cameras.watch(res, { device, label }, quality);
    });

    // Each alert's overlay, the same page: it reads the alert's id from its
    // path. Their media is mounted at /alerts/media/, a path one level deeper.
    this._app.get(`/${ALERTS_PATH}/:id`, (_req, res) => {
      res.type("html").send(ALERT_PAGE);
    });
    // The countdown timer's overlay. Express 5 matches /timer/ too.
    this._app.get(`/${TIMER_PATH}`, (_req, res) => {
      res.type("html").send(TIMER_PAGE);
    });
    // Each Overlay Studio overlay, the same page: it reads its id from its
    // path.
    this._app.get(`/${STUDIO_PATH}/:id`, (_req, res) => {
      res.type("html").send(STUDIO_PAGE);
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
      // An id like "gift-jar - Copy (2)" isn't a valid path for Express 5.
      try {
        newRouter.use("/" + id, express.static(path));
      } catch (e) {
        Logger.warn(
          `<Server> Unable to serve ${id} -- ${formatError(e)}`,
          this._logFile,
        );
      }
    });
    this._dynamicRouter = newRouter;
  }

  public getPort(): number {
    return this._port;
  }

  public get cameraKey(): string {
    return this._cameraKey;
  }

  public start(): Promise<{ success: boolean; message: string }> {
    if (this._server)
      return Promise.resolve({
        success: false,
        message: "Server already running.",
      });

    this._cameraKey = randomUUID();

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
        // The new key changed every camera URL
        this._camerasChanged();
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
    // server.close() alone leaves them streaming
    this._cameras.closeAll();
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
        connectorService.on(event, (data: TokioEventMap[TOKIO_EVENTS]) =>
          this.broadcast(event, data),
        );
      });
    musicService.on(TOKIO_EVENTS.MUSIC_CHANGE, (data) =>
      this.broadcast(TOKIO_EVENTS.MUSIC_CHANGE, data),
    );
    // An overlay that loads mid-song gets the queue, not only its next change
    this.onConnect((id) => {
      const songs = musicService.songs();
      if (songs.length === 0) return;
      this.sendToClient(id, { type: TOKIO_EVENTS.MUSIC_CHANGE, data: songs });
    });
  }

  /** Sends a chunk of a capture to the pages that stream its camera. */
  public cameraFrame(chunk: CameraChunk) {
    this._cameras.frame(chunk);
  }

  /** The cameras pages show, for the window to capture. */
  public cameraCaptures(): CameraCapture[] {
    return this._cameras.captures();
  }

  /** Calls the listener when the captures change, or a start renewed the key. */
  public onCameras(listener: (cameras: Cameras) => void) {
    this._cameraListeners.push(listener);
  }

  private _camerasChanged() {
    const cameras = { key: this._cameraKey, captures: this.cameraCaptures() };
    for (const listener of this._cameraListeners) listener(cameras);
  }

  /** Calls the listener with each overlay's id as it connects. */
  public onConnect(listener: (id: string) => void) {
    this._connectListeners.push(listener);
  }

  // Whether an overlay connected with the id got the payload.
  public sendToClient(id: string, payload: any): boolean {
    return this._wss?.sendToClient(id, payload) ?? false;
  }

  // Every overlay connected gets it, as they get the live events.
  public sendToAll(payload: TokioPayload) {
    this._wss?.broadcast(payload);
  }

  private broadcast<T extends TOKIO_EVENTS>(type: T, data: TokioEventMap[T]) {
    if (this._wss) {
      this._wss.broadcast({ type, data });
    }
  }
}
