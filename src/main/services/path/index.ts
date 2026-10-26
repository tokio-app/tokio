import { Files, Folders } from "@/common/types";
import { existsSync } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "path";

// Bigger logs are moved to `<name>.old.log` on startup, keeping one backup.
const MAX_LOG_SIZE = 5 * 1024 * 1024;

export class PathManagerService {
  public folders: Folders;
  public files: Files;

  public async initialize(
    homePath: string,
    appFolderName: string,
    callback?: (data: { files: Files; folders: Folders }) => void,
  ): Promise<void> {
    const appFolder = resolve(join(homePath, appFolderName));

    this.folders = {
      appFolder,
      settingsFolder: join(appFolder, "settings"),
      logsFolder: join(appFolder, "logs"),
      overlaysFolder: join(appFolder, "overlays"),
      profilesFolder: join(appFolder, "profiles"),
      extraFolder: join(appFolder, "extra"),
      soundsFolder: join(appFolder, "sounds"),
      mediaFolder: join(appFolder, "media"),
      // Later games get their folders next to it
      minecraftFolder: join(appFolder, "games", "minecraft"),
    };

    this.files = {
      logs: {
        connector: join(this.folders.logsFolder, "connector.log"),
        system: join(this.folders.logsFolder, "system.log"),
        server: join(this.folders.logsFolder, "server.log"),
        tts: join(this.folders.logsFolder, "tts.log"),
        alerts: join(this.folders.logsFolder, "alerts.log"),
        music: join(this.folders.logsFolder, "music.log"),
        overlays: join(this.folders.logsFolder, "overlays.log"),
        games: join(this.folders.logsFolder, "games.log"),
      },
      gifts: join(this.folders.extraFolder, "gifts.json"),
      customGifts: join(this.folders.extraFolder, "custom-gifts.json"),
    };

    const folderPaths = Object.values(this.folders);

    for (const folder of folderPaths) {
      if (!existsSync(folder)) {
        await mkdir(folder, { recursive: true });
      }
    }

    const logFiles = Object.values(this.files.logs);
    for (const file of logFiles) {
      if (existsSync(file) && (await stat(file)).size > MAX_LOG_SIZE) {
        // A log held by another program only means a bigger log, not no start
        await rename(file, file.replace(/\.log$/, ".old.log")).catch(() => {});
      }
      if (!existsSync(file)) {
        await writeFile(file, "", { encoding: "utf-8" });
      }
    }

    callback?.({ files: this.files, folders: this.folders });
  }
}
