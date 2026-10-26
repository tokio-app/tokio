import { formatError } from "@/common/util";
import config from "@/config";
import Logger from "@/logger";
import { exec } from "@vscode/sudo-prompt";
import { promises as fs } from "fs";
import { join, resolve } from "path";
import { Service } from "../shared";

export class URLManagerService extends Service {
  private _installing: Promise<boolean> | null = null;

  public installAppFQDN() {
    // Calls made while the admin prompt is open share it, so the block is added once.
    if (!this._installing) {
      this._installing = this._installAppFQDN().finally(() => {
        this._installing = null;
      });
    }
    return this._installing;
  }

  private async _installAppFQDN() {
    if (!["win32", "darwin", "linux"].includes(process.platform)) {
      Logger.error(
        `<System> Adding ${config.CMD.FQDN} to the hosts file is not supported on ${process.platform}.`,
        this._logFile,
      );
      return false;
    }

    const hostsFilePath = resolve(join(...config.CMD.HOST));

    let hostsContent: string;
    try {
      hostsContent = await fs.readFile(hostsFilePath, "utf-8");
    } catch (error) {
      Logger.error(
        `<System> Unable to read hosts file -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      return false;
    }

    if (this._hasAppFQDN(hostsContent)) return true;

    const command = this._appendCommand(hostsFilePath);

    Logger.info(
      `<System> Prompting for admin rights to add ${config.CMD.FQDN} to the hosts file.`,
      this._logFile,
    );

    const error = await new Promise<Error | undefined>((res) => {
      exec(command, { name: config.CMD.NAME }, (error) => res(error));
    });
    if (error) {
      Logger.error(
        `<System> Failed to modify hosts file -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      return false;
    }

    // Antivirus or a file lock can stop the write without failing the command.
    try {
      if (this._hasAppFQDN(await fs.readFile(hostsFilePath, "utf-8"))) {
        Logger.success(
          "<System> Successfully updated hosts file.",
          this._logFile,
        );
        return true;
      }
      Logger.error(
        `<System> Hosts file was not updated, ${config.CMD.FQDN} is still missing.`,
        this._logFile,
      );
    } catch (error) {
      Logger.error(
        `<System> Unable to read hosts file -- ${formatError(error)}`,
        this._logFile,
        error,
      );
    }
    return false;
  }

  // Windows runs this as a batch file. Linux runs it inside bash -c "..." and
  // macOS as a bash script, so it must not contain $, backticks or double quotes.
  private _appendCommand(hostsFilePath: string) {
    const lines = [
      "",
      "## Tokio App Hostname - Start ##",
      `${config.CMD.IP} ${config.CMD.FQDN}`,
      // Without it macOS can wait on a Bonjour lookup before reading the hosts file.
      `${config.CMD.IP6} ${config.CMD.FQDN}`,
      "## Tokio App Hostname - End ##",
    ];

    if (process.platform === "win32") {
      return lines
        .map((line) => `echo${line ? ` ${line}` : "."}>> ${hostsFilePath}`)
        .join("\n");
    }

    const append = lines
      .map((line) => `echo${line ? ` '${line}'` : ""} >> ${hostsFilePath}`)
      .join(" && ");
    // macOS caches lookups, flush it so the new name resolves right away.
    return process.platform === "darwin"
      ? `${append} && (dscacheutil -flushcache; killall -HUP mDNSResponder; true)`
      : append;
  }

  // Only the IPv4 line is required, so hosts files from older versions still count.
  // Commented lines, other IPs and look-alike names don't.
  private _hasAppFQDN(hostsContent: string) {
    const fqdn = config.CMD.FQDN.toLowerCase();
    return hostsContent.split(/\r?\n/).some((line) => {
      const [ip, ...names] = line.split("#")[0].trim().split(/\s+/);
      return (
        ip === config.CMD.IP && names.some((n) => n.toLowerCase() === fqdn)
      );
    });
  }
}
