import {
  AppError,
  AppNotification,
  FEEDBACK_CODES,
  FeedbackLevel,
  FeedbackSource,
} from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { randomUUID } from "node:crypto";

export const UNKNOWN_ERROR: AppError = {
  code: FEEDBACK_CODES.UNKNOWN,
  message: "Something went wrong.",
};

// The same warning or error is sent at most once in this window.
export const DEDUPE_MS = 5000;

const LABELS: Record<FeedbackSource, string> = {
  system: "System",
  connector: "Connector",
  server: "Server",
  tts: "TTS",
  alerts: "Alerts",
  music: "Music",
  overlays: "Overlays",
};

type FailureLevel = Extract<FeedbackLevel, "warning" | "error">;

/**
 * An expected failure, with the code and message the user should see.
 * Anything else that is thrown is reported with a generic message.
 */
export class AppFailure extends Error {
  public readonly code: FEEDBACK_CODES;
  public readonly level: FailureLevel;
  public readonly notify: boolean;
  // The service already logged it, report() doesn't log it again
  public readonly logged: boolean;

  constructor(
    code: FEEDBACK_CODES,
    message: string,
    options: {
      level?: FailureLevel;
      notify?: boolean;
      logged?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppFailure";
    this.code = code;
    this.level = options.level ?? "error";
    this.notify = options.notify ?? true;
    this.logged = options.logged ?? false;
  }
}

// A store write that failed. JSONManagerService logged why.
export const saveFailure = () =>
  new AppFailure(
    FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
    "Tokio couldn't save the change. Check the logs folder for details.",
    { logged: true },
  );

/**
 * A failure a service already logged with its details, such as the error of
 * a `{ success: false, error }` result. It's reported like any other error,
 * without a second log line.
 */
export class LoggedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "LoggedError";
  }
}

export function toAppError(
  error: unknown,
  fallback: AppError = UNKNOWN_ERROR,
): AppError {
  if (error instanceof AppFailure) {
    return { code: error.code, message: error.message };
  }
  return { ...fallback };
}

type NotificationInput = Omit<AppNotification, "id" | "timestamp">;

interface NotifyOptions {
  // Notices with the same key are deduped, source and code by default
  key?: string;
  // DEDUPE_MS for warnings and errors. Successes and info answer something
  // the user did, so they aren't deduped unless a window is given.
  windowMs?: number;
}

interface ReportOptions {
  source: FeedbackSource;
  error: unknown;
  // Used when the error isn't an AppFailure
  fallback?: AppError;
  // What was being done, for the log
  context?: string;
  notify?: boolean;
}

/**
 * Sends notifications to the main window and reports failures: logs them
 * and tells the user, so every failure is reported the same way.
 */
export class Notifier {
  private readonly _send: (notification: AppNotification) => void;
  private _logFiles: Partial<Record<FeedbackSource, string>> = {};
  // Until when each key's repeats are dropped
  private _muted = new Map<string, number>();

  constructor(send: (notification: AppNotification) => void) {
    this._send = send;
  }

  public setLogFiles(logFiles: Partial<Record<FeedbackSource, string>>) {
    this._logFiles = logFiles;
  }

  /** Returns false when the notice was a repeat or couldn't be sent. */
  public notify(input: NotificationInput, options: NotifyOptions = {}) {
    const { key = `${input.source}:${input.code ?? input.message}` } = options;
    const failure = input.level === "warning" || input.level === "error";
    const windowMs = options.windowMs ?? (failure ? DEDUPE_MS : 0);
    const now = Date.now();

    for (const [k, until] of this._muted) {
      if (until <= now) this._muted.delete(k);
    }
    if (this._muted.has(key)) return false;
    if (windowMs > 0) this._muted.set(key, now + windowMs);

    try {
      this._send({ ...input, id: randomUUID(), timestamp: now });
      return true;
    } catch (error) {
      Logger.error(
        `<System> Unable to send a notification -- ${formatError(error)}`,
        this._logFiles.system,
        error,
      );
      return false;
    }
  }

  public error(
    source: FeedbackSource,
    code: FEEDBACK_CODES,
    message: string,
    options?: NotifyOptions,
  ) {
    return this.notify({ level: "error", source, code, message }, options);
  }

  public warn(
    source: FeedbackSource,
    code: FEEDBACK_CODES,
    message: string,
    options?: NotifyOptions,
  ) {
    return this.notify({ level: "warning", source, code, message }, options);
  }

  public info(
    source: FeedbackSource,
    code: FEEDBACK_CODES,
    message: string,
    options?: NotifyOptions,
  ) {
    return this.notify({ level: "info", source, code, message }, options);
  }

  public success(
    source: FeedbackSource,
    code: FEEDBACK_CODES,
    message: string,
    options?: NotifyOptions,
  ) {
    return this.notify({ level: "success", source, code, message }, options);
  }

  /**
   * Logs a failure to the source's log file and notifies the user, unless
   * `notify` is false or the AppFailure opted out. Returns what to reply with.
   */
  public report({
    source,
    error,
    fallback,
    context,
    notify = true,
  }: ReportOptions): AppError {
    const appError = toAppError(error, fallback);
    const failure = error instanceof AppFailure ? error : null;
    const level = failure?.level ?? "error";
    const logged = error instanceof LoggedError || failure?.logged;

    // An AppFailure's own message is already in the log line.
    const detail = failure ? failure.cause : error;
    const where = context ? ` (${context})` : "";
    const msg = `<${LABELS[source]}> ${appError.message}${where} [${appError.code}]`;
    const line =
      detail === undefined ? msg : `${msg} -- ${formatError(detail)}`;
    const logFile = this._logFiles[source];
    if (!logged && level === "warning") {
      Logger.warn(line, logFile);
    } else if (!logged) {
      Logger.error(line, logFile, detail);
    }

    if (notify && (failure?.notify ?? true)) {
      this.notify({ level, source, ...appError });
    }
    return appError;
  }
}
