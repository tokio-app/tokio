import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppNotification,
  FEEDBACK_CODES,
} from "@/common/types";
import Logger from "@/logger";
import {
  AppHandlerVariables,
  EventCallback,
  EventOptions,
  ReplyEvent,
} from "@/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStack, replyFailure, runEvent } from "./events";
import { AppFailure, Notifier } from "./feedback";

// Stand-ins with only what runEvent reads
const asHandler = (value: any): AppHandlerVariables => value;
const asReplyEvent = (value: any): ReplyEvent => value;

const failure = {
  code: FEEDBACK_CODES.PROFILE_CREATE_FAILED,
  message: "Unable to create the profile.",
};

describe("runEvent", () => {
  let sent: AppNotification[];
  let handler: AppHandlerVariables;
  let reply: ReturnType<typeof vi.fn>;
  let e: ReplyEvent;

  beforeEach(() => {
    sent = [];
    const notifier = new Notifier((n) => sent.push(n));
    notifier.setLogFiles({ system: "system.log", alerts: "alerts.log" });
    handler = asHandler({
      notifier,
      pathManagerService: { files: { logs: { system: "system.log" } } },
    });
    reply = vi.fn();
    e = asReplyEvent({ reply });
  });

  // Runs the only handler of a stack, the way the Handler does.
  const run = async (
    callback: EventCallback<APP_EVENTS.CREATE_PROFILE>,
    options?: EventOptions<APP_EVENTS.CREATE_PROFILE>,
    source?: "alerts",
  ) => {
    const stack = createStack(source);
    stack.push(APP_EVENTS.CREATE_PROFILE, callback, options);
    const [item] = stack.getEvents();
    await runEvent(item, handler, e, { name: "Main" });
  };

  it("doesn't report a handler that succeeds", async () => {
    const error = vi.spyOn(Logger, "error");

    await run(async (_, e) => {
      e.reply(APP_EVENTS_RESPONSE.CREATE_PROFILE, { success: true });
    });

    expect(reply).toHaveBeenCalledExactlyOnceWith(
      APP_EVENTS_RESPONSE.CREATE_PROFILE,
      { success: true },
    );
    expect(error).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("replies, logs and notifies with an AppFailure's error", async () => {
    const warn = vi.spyOn(Logger, "warn");
    const onError = vi.fn();

    await run(
      () => {
        throw new AppFailure(
          FEEDBACK_CODES.PROFILE_LOCKED,
          "Disconnect first.",
          {
            level: "warning",
          },
        );
      },
      { failure, onError },
    );

    const error = {
      code: FEEDBACK_CODES.PROFILE_LOCKED,
      message: "Disconnect first.",
    };
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      e,
      error,
      { name: "Main" },
      handler,
    );
    expect(sent).toEqual([
      expect.objectContaining({ level: "warning", source: "system", ...error }),
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(APP_EVENTS.CREATE_PROFILE),
      "system.log",
    );
  });

  it("reports other errors with the handler's failure and the stack's source", async () => {
    const logError = vi.spyOn(Logger, "error");
    const cause = new Error("EACCES");

    await run(
      async () => {
        throw cause;
      },
      { failure, onError: replyFailure(APP_EVENTS_RESPONSE.CREATE_PROFILE) },
      "alerts",
    );

    expect(reply).toHaveBeenCalledWith(APP_EVENTS_RESPONSE.CREATE_PROFILE, {
      success: false,
      error: failure,
    });
    expect(sent[0]).toMatchObject({
      source: "alerts",
      level: "error",
      ...failure,
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("EACCES"),
      "alerts.log",
      cause,
    );
  });

  it("only replies when notify is off", async () => {
    vi.spyOn(Logger, "error");
    const onError = vi.fn();

    await run(
      () => {
        throw new Error("x");
      },
      { notify: false, onError },
    );

    expect(onError).toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("contains an onError that throws", async () => {
    const logError = vi.spyOn(Logger, "error");

    await expect(
      run(
        () => {
          throw new Error("x");
        },
        {
          onError: () => {
            throw new Error("window closed");
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("window closed"),
      "system.log",
      expect.any(Error),
    );
  });
});
