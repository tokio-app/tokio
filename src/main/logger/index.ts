import { track } from "@/helper/quit";
import { appendFile } from "node:fs/promises";
import { inspect } from "node:util";

type Level = "INFO" | "WARN" | "SUCCESS" | "ERROR";

export default class Logger {
  // One write chain per file keeps its lines in call order.
  private static _writes = new Map<string, Promise<void>>();
  // Files whose last write failed, so a broken file is reported only once.
  private static _failed = new Set<string>();

  private static log(
    level: Level,
    msg: string,
    logFile?: string,
    error?: unknown,
  ) {
    // inspect prints the stack, the cause chain and fields such as `code`.
    const text = error instanceof Error ? `${msg}\n${inspect(error)}` : msg;
    const line = `${new Date().toISOString()} -- [${level}]: ${text.replace(/\n/g, "\n    ")}`;

    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);

    if (logFile) Logger.write(logFile, `${line}\n`);
  }

  private static write(logFile: string, line: string) {
    const previous = Logger._writes.get(logFile) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
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

  public static info(msg: string, logFile?: string) {
    Logger.log("INFO", msg, logFile);
  }
  public static warn(msg: string, logFile?: string) {
    Logger.log("WARN", msg, logFile);
  }
  public static success(msg: string, logFile?: string) {
    Logger.log("SUCCESS", msg, logFile);
  }
  /** Pass the caught `error` to append its stack trace to the entry. */
  public static error(msg: string, logFile?: string, error?: unknown) {
    Logger.log("ERROR", msg, logFile, error);
  }
}
