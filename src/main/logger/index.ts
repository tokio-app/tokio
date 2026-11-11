import { track } from "@/helper/quit";
import { zipSync } from "fflate";
import { appendFile, readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";

type Level = "error" | "warn" | "info" | "debug";

// A bigger log is moved to `<name>.old.log` before its next line, keeping one
// backup, so a long LIVE can't grow it past this.
const MAX_LOG_SIZE = 5 * 1024 * 1024;

// The wall clock, as desktop apps write their logs: shifted by the zone's
// offset, toISOString prints the local time.
export const localTime = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");

export default class Logger {
  // One write chain per file keeps its lines in call order.
  private static _writes = new Map<string, Promise<void>>();
  // Files whose last write failed, so a broken file is reported only once.
  private static _failed = new Set<string>();
  // Settings → Logs → Detailed logs
  private static _debug = false;

  private static format(level: Level, msg: string, error?: unknown) {
    // inspect prints the stack, the cause chain and fields such as `code`.
    const text = error instanceof Error ? `${msg}\n${inspect(error)}` : msg;
    return `${localTime()} [${level}] ${text.replace(/\n/g, "\n    ")}`;
  }

  private static log(
    level: Level,
    msg: string,
    logFile?: string,
    error?: unknown,
  ) {
    const line = Logger.format(level, msg, error);

    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);

    if (logFile) Logger.write(logFile, `${line}\n`);
  }

  private static write(logFile: string, line: string) {
    const previous = Logger._writes.get(logFile) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        await Logger.rotate(logFile);
        await appendFile(logFile, line, "utf-8");
        Logger._failed.delete(logFile);
      } catch (error) {
        // Logging must never crash the app, so the error stops here.
        if (Logger._failed.has(logFile)) return;
        Logger._failed.add(logFile);
        console.error(`Logger: unable to write to ${logFile}`, error);
      }
    });
    // A quit waits for it too.
    Logger._writes.set(logFile, track(next));
    void next.then(() => {
      if (Logger._writes.get(logFile) === next) Logger._writes.delete(logFile);
    });
  }

  // In the file's write chain, so no line lands between the check and the move
  private static async rotate(logFile: string) {
    const size = await stat(logFile).then(
      ({ size }) => size,
      () => 0,
    );
    if (size <= MAX_LOG_SIZE) return;
    // A log another program holds only grows past the limit
    await rename(logFile, logFile.replace(/\.log$/, ".old.log")).catch(
      () => {},
    );
  }

  /** Detailed logs: `debug` lines are written only while it's on. */
  public static setDebug(on: boolean) {
    Logger._debug = on;
  }

  /** Starts a run in every file with what wrote it, printed once. */
  public static run(text: string, logFiles: string[]) {
    const line = Logger.format("info", text);
    console.log(line);
    for (const logFile of logFiles) Logger.write(logFile, `${line}\n`);
  }

  /**
   * Zips every log in the folder, the backups too, once the writes still
   * running are done.
   */
  public static async zip(folder: string): Promise<Uint8Array> {
    await Promise.all(Logger._writes.values());
    const files: Record<string, Uint8Array> = {};
    for (const name of await readdir(folder)) {
      if (!name.endsWith(".log")) continue;
      files[name] = await readFile(join(folder, name));
    }
    // shortcut: zipSync blocks main while it compresses. Each log stays under
    // 5 MB, so switch to fflate's async zip if exports get slow.
    return zipSync(files);
  }

  public static debug(msg: string, logFile?: string) {
    if (Logger._debug) Logger.log("debug", msg, logFile);
  }
  public static info(msg: string, logFile?: string) {
    Logger.log("info", msg, logFile);
  }
  public static warn(msg: string, logFile?: string) {
    Logger.log("warn", msg, logFile);
  }
  /** Pass the caught `error` to append its stack trace to the entry. */
  public static error(msg: string, logFile?: string, error?: unknown) {
    Logger.log("error", msg, logFile, error);
  }
}
