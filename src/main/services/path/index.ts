import { Files, Folders } from "@/common/types";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "path";

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
      // Each profile's fans, under the profile's file name
      fansFolder: join(appFolder, "fans"),
      // Each profile's LIVEs, in a folder named after the profile's file
      historyFolder: join(appFolder, "history"),
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

    // Logger moves a log past its size limit to a backup as it writes
    for (const file of Object.values(this.files.logs)) {
      if (!existsSync(file)) {
        await writeFile(file, "", { encoding: "utf-8" });
      }
    }

    callback?.({ files: this.files, folders: this.folders });
  }
}
