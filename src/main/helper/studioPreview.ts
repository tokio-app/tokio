import { StudioOverlay } from "@/common/schemas";
import { StudioView } from "@/common/types";
import { AppHandlerVariables } from "@/types";
import { BrowserWindow, screen, session } from "electron";
import { studioSampleView } from "./studio";

type Services = Pick<AppHandlerVariables, "overlayService" | "serverService">;

export type StudioPreview = {
  png: Buffer;
  width: number;
  height: number;
  // Pictures, videos and embeds that failed to load or timed out
  failed: number;
};

// Its own, in memory: the app's session cancels every WebSocket to the
// overlay server (initSession), and embedded overlays need theirs
const PARTITION = "studio-preview";
export const PREVIEW_TIMEOUT_MS = 15_000;
// Between the capture that wakes the page's raster and the one kept: 300 ms
// was enough for a busy canvas here
const SETTLE_MS = 500;

// The previews running and waiting, so calls can't stack windows
let queue: Promise<unknown> = Promise.resolve();

// The window, in the picture's shape but no bigger than the screen's work
// area: Windows clamps a window to the screen, hidden or offscreen, which
// squeezed the canvas into a window of the wrong shape
const windowSize = (width: number, height: number) => {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const fit = Math.min(1, area.width / width, area.height / height);
  return {
    width: Math.max(1, Math.floor(width * fit)),
    height: Math.max(1, Math.floor(height * fit)),
  };
};

// Where the page draws the canvas in the window: fitted and centered, as the
// stage's fit() places it, in case the window still got another size
const canvasRect = (view: StudioView, win: BrowserWindow) => {
  const { width: w, height: h } = win.getContentBounds();
  const scale = Math.min(w / view.width, h / view.height);
  const width = Math.round(view.width * scale);
  const height = Math.round(view.height * scale);
  return {
    x: Math.floor((w - width) / 2),
    y: Math.floor((h - height) / 2),
    width,
    height,
  };
};

/**
 * A PNG of a studio overlay as its page draws it, with Test's samples, at
 * scale times its canvas. One at a time, each in a hidden window it always
 * destroys.
 */
export function previewStudioOverlay(
  services: Services,
  overlay: StudioOverlay,
  scale: number,
): Promise<StudioPreview> {
  const run = queue.then(() => capture(services, overlay, scale));
  queue = run.catch(() => {});
  return run;
}

async function capture(
  { overlayService, serverService }: Services,
  overlay: StudioOverlay,
  scale: number,
): Promise<StudioPreview> {
  const view = await studioSampleView({ overlayService }, overlay);
  const width = Math.round(view.width * scale);
  const height = Math.round(view.height * scale);

  const partition = session.fromPartition(PARTITION);
  partition.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  partition.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    show: false,
    ...windowSize(width, height),
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    enableLargerThanScreen: true,
    // Shows through the transparent parts, light and dark elements both
    backgroundColor: "#7f7f7f",
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const { webContents } = win;
    webContents.setAudioMuted(true);
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    webContents.on("will-navigate", (event) => event.preventDefault());

    const shot = async (): Promise<StudioPreview> => {
      const id = encodeURIComponent(overlay.id);
      await win.loadURL(
        `http://127.0.0.1:${serverService.getPort()}/studio/${id}/?preview`,
      );
      const failed: unknown = await webContents.executeJavaScript(
        `TokioPreview(${JSON.stringify(view)})`,
      );
      // The canvas alone, at the display's scale factor: smaller than the
      // picture when the screen is, then scaled up a little soft. A hidden
      // page rasters what a capture shows only once one asks, so the first
      // can miss the texts of a busy canvas: it's thrown away.
      // shortcut: a fixed wait for the raster; if a slow PC still misses
      // texts, capture until two pictures agree.
      const rect = canvasRect(view, win);
      await webContents.capturePage(rect);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      const image = (await webContents.capturePage(rect)).resize({
        width,
        height,
      });
      return {
        png: image.toPNG(),
        width,
        height,
        failed: typeof failed === "number" ? failed : 0,
      };
    };
    return await Promise.race([
      shot(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${PREVIEW_TIMEOUT_MS} ms`)),
          PREVIEW_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    win.destroy();
  }
}
