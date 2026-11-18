import { StudioOverlay } from "@/common/schemas";
import { AppHandlerVariables } from "@/types";
import { BrowserWindow, session } from "electron";
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

// The previews running and waiting, so calls can't stack windows
let queue: Promise<unknown> = Promise.resolve();

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
    width,
    height,
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
      // It comes at the display's scale factor
      const image = (await webContents.capturePage()).resize({ width, height });
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
