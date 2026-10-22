import { AppNotification, FEEDBACK_CODES } from "@/common/types";
import Logger from "@/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppFailure,
  LoggedError,
  DEDUPE_MS,
  Notifier,
  toAppError,
  UNKNOWN_ERROR,
} from "./feedback";

const fallback = {
  code: FEEDBACK_CODES.PROFILE_CREATE_FAILED,
  message: "Unable to create the profile.",
};

describe("toAppError", () => {
  it("keeps the code and message of an AppFailure", () => {
    const error = new AppFailure(
      FEEDBACK_CODES.PROFILE_LOCKED,
      "Disconnect first.",
    );

    expect(toAppError(error, fallback)).toEqual({
      code: FEEDBACK_CODES.PROFILE_LOCKED,
      message: "Disconnect first.",
    });
  });

  it("hides other errors behind the fallback", () => {
    expect(toAppError(new Error("EACCES: /secret/path"), fallback)).toEqual(
      fallback,
    );
    expect(toAppError("boom")).toEqual(UNKNOWN_ERROR);
  });
});

describe("Notifier", () => {
  let sent: AppNotification[];
  let notifier: Notifier;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    notifier = new Notifier((n) => sent.push(n));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds an id and a timestamp", () => {
    vi.setSystemTime(1000);

    notifier.info(
      "connector",
      FEEDBACK_CODES.LIVE_ENDED,
      "The LIVE has ended.",
    );

    expect(sent).toEqual([
      {
        id: expect.any(String),
        timestamp: 1000,
        level: "info",
        source: "connector",
        code: FEEDBACK_CODES.LIVE_ENDED,
        message: "The LIVE has ended.",
      },
    ]);
  });

  it("drops repeats of the same notice within the window", () => {
    const send = () =>
      notifier.error("tts", FEEDBACK_CODES.TTS_GENERATION_FAILED, "No audio.");

    expect(send()).toBe(true);
    expect(send()).toBe(false);
    vi.advanceTimersByTime(DEDUPE_MS);
    expect(send()).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("sends every success and info, unless given a window", () => {
    const switched = (windowMs?: number) =>
      notifier.success("system", FEEDBACK_CODES.PROFILE_SWITCHED, "Switched.", {
        windowMs,
      });

    expect(switched()).toBe(true);
    expect(switched()).toBe(true);
    expect(switched(1000)).toBe(true);
    expect(switched(1000)).toBe(false);
    expect(sent.map((n) => n.level)).toEqual(["success", "success", "success"]);
  });

  it("dedupes by key, with the key's own window", () => {
    const missing = (id: string) =>
      notifier.warn("alerts", FEEDBACK_CODES.ALERT_SOUND_MISSING, "Missing.", {
        key: `alert:${id}`,
        windowMs: 60_000,
      });

    expect(missing("a")).toBe(true);
    expect(missing("b")).toBe(true);
    // A shorter window elsewhere doesn't expire this one.
    vi.advanceTimersByTime(DEDUPE_MS);
    notifier.info("connector", FEEDBACK_CODES.LIVE_ENDED, "Ended.");
    expect(missing("a")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(missing("a")).toBe(true);
  });

  it("logs instead of throwing when the window is gone", () => {
    const error = vi.spyOn(Logger, "error");
    const broken = new Notifier(() => {
      throw new Error("Object has been destroyed");
    });

    expect(broken.info("system", FEEDBACK_CODES.UNKNOWN, "Hi.")).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  describe("report", () => {
    beforeEach(() => {
      notifier.setLogFiles({ system: "system.log", alerts: "alerts.log" });
    });

    it("logs to the source's file and notifies with the fallback", () => {
      const error = vi.spyOn(Logger, "error");
      const cause = new Error("disk full");

      const res = notifier.report({
        source: "alerts",
        error: cause,
        fallback,
        context: "app:sounds:upload",
      });

      expect(res).toEqual(fallback);
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(
          /^<Alerts> Unable to create the profile\. \(app:sounds:upload\).*disk full$/,
        ),
        "alerts.log",
        cause,
      );
      expect(sent).toEqual([
        expect.objectContaining({
          level: "error",
          source: "alerts",
          ...fallback,
        }),
      ]);
    });

    it("uses an AppFailure's level and logs warnings as warnings", () => {
      const warn = vi.spyOn(Logger, "warn");

      notifier.report({
        source: "system",
        error: new AppFailure(
          FEEDBACK_CODES.PROFILE_LOCKED,
          "Disconnect first.",
          {
            level: "warning",
          },
        ),
      });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Disconnect first."),
        "system.log",
      );
      expect(sent[0]).toMatchObject({
        level: "warning",
        code: FEEDBACK_CODES.PROFILE_LOCKED,
      });
    });

    it("doesn't log again what the service already logged", () => {
      const error = vi.spyOn(Logger, "error");

      const res = notifier.report({
        source: "alerts",
        error: new LoggedError("MyInstants responded with status: 503"),
        fallback,
      });
      notifier.report({
        source: "connector",
        error: new AppFailure(FEEDBACK_CODES.CONNECT_FAILED, "Offline.", {
          logged: true,
        }),
      });

      expect(res).toEqual(fallback);
      expect(error).not.toHaveBeenCalled();
      expect(sent.map((n) => n.code)).toEqual([
        fallback.code,
        FEEDBACK_CODES.CONNECT_FAILED,
      ]);
    });

    it("only logs when notify is off, by option or by the failure", () => {
      const error = vi.spyOn(Logger, "error");

      notifier.report({
        source: "system",
        error: new Error("x"),
        notify: false,
      });
      notifier.report({
        source: "system",
        error: new AppFailure(FEEDBACK_CODES.UNKNOWN, "Quiet.", {
          notify: false,
        }),
      });

      expect(sent).toEqual([]);
      expect(error).toHaveBeenCalledTimes(2);
    });
  });
});
