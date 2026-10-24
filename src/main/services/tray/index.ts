import { app, Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";

/**
 * Tokio's icon in the tray, the menu bar on macOS, while Settings → Tray is
 * on. Closing the window then only hides it (see AppHandler), and the icon
 * opens it again or quits.
 */
export class TrayService {
  // Kept while it shows, a tray that's garbage collected loses its icon
  private _tray: Tray | null = null;
  private _open = () => {};

  /** What opening Tokio from the icon does: AppHandler shows the window. */
  public onOpen(listener: () => void) {
    this._open = listener;
  }

  public isEnabled() {
    return this._tray !== null;
  }

  public setEnabled(enabled: boolean) {
    if (!enabled) {
      this._tray?.destroy();
      this._tray = null;
      return;
    }
    if (this._tray) return;

    // The menu bar shows it at its size in points, Windows and Linux scale it
    const icon = nativeImage
      .createFromPath(join(__dirname, "../../resources/icon.png"))
      .resize({ width: process.platform === "darwin" ? 16 : 32 });
    this._tray = new Tray(icon);
    this._tray.setToolTip("Tokio");
    this._tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Tokio", click: () => this._open() },
        { label: "Quit Tokio", click: () => app.quit() },
      ]),
    );
    this._tray.on("click", () => this._open());
  }
}
