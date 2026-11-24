import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  AppEventsMap,
  AppEventsResponseMap,
  FeedbackSource,
} from "@/common/types";
import { formatError } from "@/common/util";
import { unknownError } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import { track } from "@/helper/quit";
import Logger from "@/logger";
import {
  AppHandlerVariables,
  EventCallback,
  EventItem,
  EventOptions,
  InvokeResult,
  ReplyEvent,
  SentReply,
} from "@/types";

export type Stack = EventStack;

/** What `CONNECTED` says about the LIVE connection, as main holds it now. */
export const connectionState = ({
  connectorService,
  liveService,
  storeManagerService,
}: Pick<
  AppHandlerVariables,
  "connectorService" | "liveService" | "storeManagerService"
>): AppEventsResponseMap[APP_EVENTS_RESPONSE.CONNECTED] => ({
  // Connecting, connected, coming back or looking again: the profile lock
  success: connectorService.isConnected(),
  // A connect in progress, or a look for the LIVE, has no session
  live: liveService.getSession().startedAt !== null,
  reconnecting: connectorService.isReconnecting(),
  waiting: connectorService.isWaiting(),
  platforms: connectorService.status(),
  stats: {
    ...storeManagerService.getLiveStats(),
    platformViewers: connectorService.viewers(),
  },
});

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
 * Resolves with the reported error, undefined when it didn't throw.
 */
export async function runEvent<K extends APP_EVENTS>(
  { event, callback, options }: EventItem<K>,
  handler: AppHandlerVariables,
  e: ReplyEvent,
  data: AppEventsMap[K],
): Promise<AppError | undefined> {
  try {
    await callback(handler, e, data);
    return undefined;
  } catch (error) {
    const { failure } = options;
    const appError = handler.notifier.report({
      source: options.source ?? "system",
      error,
      fallback: failure && { ...failure, message: t(failure.message) },
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
    return appError;
  }
}

// Replies a page acts on as the answer to its own request, by closing a
// dialog or taking the data, so the window only gets them when it asked.
export const PRIVATE_REPLIES: ReadonlySet<APP_EVENTS_RESPONSE> = new Set([
  APP_EVENTS_RESPONSE.CREATE_PROFILE,
  APP_EVENTS_RESPONSE.CLONE_PROFILE,
  APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG,
  APP_EVENTS_RESPONSE.TEST_OVERLAY,
  APP_EVENTS_RESPONSE.SET_ALERT_SOUND,
  APP_EVENTS_RESPONSE.SET_ALERT_MEDIA,
  APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE,
  APP_EVENTS_RESPONSE.GET_TTS_TEST,
  APP_EVENTS_RESPONSE.TEST_ALERT,
  APP_EVENTS_RESPONSE.SOUND_DATA,
]);

/**
 * Runs the handler of `event` from `items` in main (Handler.invoke), with
 * the replies it sends until it's done. Every reply but PRIVATE_REPLIES
 * also goes to the main window, so its pages show what changed.
 */
export async function invokeEvent<K extends APP_EVENTS>(
  items: ReadonlyMap<APP_EVENTS, EventItem<any>>,
  handler: AppHandlerVariables,
  event: K,
  data: AppEventsMap[K],
): Promise<InvokeResult> {
  const item: EventItem<K> | undefined = items.get(event);
  if (!item) {
    Logger.error(
      `<System> No handler for ${event}`,
      handler.pathManagerService.files?.logs.system,
    );
    return { error: unknownError(), replies: [] };
  }

  const replies: SentReply[] = [];
  let done = false;
  const e: ReplyEvent = {
    reply: (channel, args) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TS can't tie a generic channel to its data
      if (!done) replies.push([channel, args] as SentReply);
      // Also after it's done: a handler can keep e and reply later
      // (CONNECT_MUSIC)
      if (PRIVATE_REPLIES.has(channel) || handler.win.isDestroyed()) return;
      handler.win.webContents.send(channel, args);
    },
  };
  // A quit waits for it, as for a message from the window
  const error = await track(runEvent(item, handler, e, data));
  done = true;
  return { error, replies };
}
