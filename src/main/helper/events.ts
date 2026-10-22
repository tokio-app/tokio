import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  AppEventsMap,
  AppEventsResponseMap,
  FeedbackSource,
} from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import {
  AppHandlerVariables,
  EventCallback,
  EventItem,
  EventOptions,
  ReplyEvent,
} from "@/types";

export type Stack = EventStack;

class EventStack {
  // Handlers of different events, each checked against its event by push
  private evs: EventItem<any>[];
  private source: FeedbackSource;

  constructor(source: FeedbackSource) {
    this.evs = [];
    this.source = source;
  }

  public push<E extends APP_EVENTS>(
    event: E,
    callback: EventCallback<E>,
    options: EventOptions<E> = {},
  ) {
    if (!event || !callback) return;
    this.evs.push({
      event,
      callback,
      options: { source: this.source, ...options },
    });
  }

  public getEvents() {
    return this.evs;
  }

  public merge(events: EventStack) {
    this.evs.push(...events.getEvents());
  }
}

// Every handler in the stack reports its failures as `source`.
export function createStack(source: FeedbackSource = "system"): Stack {
  return new EventStack(source);
}

export function mergeStacks(...stacks: Stack[]): Stack {
  const events = createStack();
  for (const ev of stacks) {
    events.merge(ev);
  }
  return events;
}

// Responses that can fail with nothing but the error.
type FailureOnly = {
  [T in APP_EVENTS_RESPONSE]: {
    success: false;
    error: AppError;
  } extends AppEventsResponseMap[T]
    ? T
    : never;
}[APP_EVENTS_RESPONSE];

/** An `onError` that replies `{ success: false, error }` on `response`. */
export const replyFailure =
  (response: FailureOnly) => (e: ReplyEvent, error: AppError) => {
    e.reply(response, { success: false, error });
  };

/**
 * Runs a handler. When it throws, the failure is logged and reported to the
 * user, then the handler's `onError` sends the page its failure reply.
 */
export async function runEvent<K extends APP_EVENTS>(
  { event, callback, options }: EventItem<K>,
  handler: AppHandlerVariables,
  e: ReplyEvent,
  data: AppEventsMap[K],
) {
  try {
    await callback(handler, e, data);
  } catch (error) {
    const appError = handler.notifier.report({
      source: options.source ?? "system",
      error,
      fallback: options.failure,
      context: event,
      notify: options.notify,
    });
    try {
      options.onError?.(e, appError, data, handler);
    } catch (replyError) {
      Logger.error(
        `<System> Unable to reply to ${event} -- ${formatError(replyError)}`,
        handler.pathManagerService.files?.logs.system,
        replyError,
      );
    }
  }
}
