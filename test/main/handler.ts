import type {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
  AppNotification,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { runEvent, type Stack } from "@/helper/events";
import { Notifier } from "@/helper/feedback";
import type { AppHandlerVariables, AppServices, ReplyEvent } from "@/types";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { app, FakeBrowserWindow, ipcMain, session, shell } from "./electron";

// A stub leaves out what the handler doesn't read, also in what its methods
// return, and async methods can answer right away.
type Stub<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => StubResult<R>
  : T extends object
    ? { [K in keyof T]?: Stub<T[K]> }
    : T;

type StubResult<R> =
  R extends Promise<infer P> ? Promise<Stub<P>> | Stub<P> : Stub<R>;

type ServiceStubs = { [K in keyof AppServices]?: Stub<AppServices[K]> };

const SERVICES: (keyof AppServices)[] = [
  "connectorService",
  "ttsService",
  "musicService",
  "serverService",
  "overlayService",
  "urlManagerService",
  "jsonManagerService",
  "storeManagerService",
  "pathManagerService",
  "yamlManagerService",
  "alertsService",
  "licensesService",
  "updaterService",
  "liveService",
];

// Read by Vitest and Node when they print or await a value
const INSPECTED = new Set(["then", "toJSON", "asymmetricMatch", "$$typeof"]);

class UnexpectedUse extends Error {}

// A service that fails the test when the handler reaches for something the
// test didn't stub, instead of turning it into a failure reply. `onUse` gets
// the error too, for uses inside onError, whose throws are only logged.
function strict(
  name: string,
  stub: object = {},
  onUse: (error: UnexpectedUse) => void = () => {},
): object {
  return new Proxy(stub, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || INSPECTED.has(prop) || prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      const error = new UnexpectedUse(
        `The handler used ${name}.${prop}, stub it.`,
      );
      onUse(error);
      throw error;
    },
  });
}

// The fakes stand in for Electron's types
const asHandler = (value: any): AppHandlerVariables => value;
const asReplyEvent = (value: any): ReplyEvent => value;

/**
 * What a Handler gets, for a test: the services passed as stubs, fakes of
 * the windows and Electron modules, and a real Notifier whose notices the
 * test reads. `invoke` runs a handler from a page's stack as the Handler does.
 */
export function createHandler(services: ServiceStubs = {}) {
  const notices: AppNotification[] = [];
  // Replies as [channel, data] and notices as ["notice", notice], in order
  const sent: [string, unknown][] = [];
  const notifier = new Notifier((notification) => {
    notices.push(notification);
    sent.push(["notice", notification]);
  });
  notifier.setLogFiles({ system: "system.log" });
  const report = notifier.report.bind(notifier);
  notifier.report = (options) => {
    if (options.error instanceof UnexpectedUse) throw options.error;
    return report(options);
  };

  const win = new FakeBrowserWindow();
  const splash = new FakeBrowserWindow({ show: false });
  const reply = vi.fn<ReplyEvent["reply"]>((channel, data) => {
    sent.push([channel, data]);
  });

  // The first unstubbed use during an invoke, rethrown once it's done
  let unexpected: UnexpectedUse | undefined;
  const stubs: Record<string, object> = {
    pathManagerService: { files: { logs: { system: "system.log" } } },
    ...services,
  };
  const handler = asHandler({
    app,
    win,
    splash,
    ipcMain,
    shell,
    session,
    notifier,
    ...Object.fromEntries(
      SERVICES.map((name) => [
        name,
        strict(name, stubs[name], (error) => {
          unexpected ??= error;
        }),
      ]),
    ),
  });

  return {
    handler,
    win,
    splash,
    notices,

    /** Runs the stack's handler for an event, like a message from the page. */
    async invoke<E extends APP_EVENTS>(
      stack: Stack,
      event: E,
      data?: AppEventsMap[E],
    ) {
      const item = stack.getEvents().find((ev) => ev.event === event);
      if (!item) throw new Error(`The stack doesn't handle ${event}.`);
      unexpected = undefined;
      await runEvent(item, handler, asReplyEvent({ reply }), data);
      if (unexpected) throw unexpected;
    },

    /** What the handlers replied on a channel, oldest first. */
    replies<R extends APP_EVENTS_RESPONSE>(channel: R) {
      return reply.mock.calls
        .filter((call): call is [R, AppEventsResponseMap[R]] => {
          return call[0] === channel;
        })
        .map(([, data]) => data);
    },

    /** Every reply and notice so far, in the order they were sent. */
    sent: () => [...sent],

    /** What main sent to the window on a channel without a request. */
    pushed<R extends APP_EVENTS_RESPONSE>(channel: R) {
      return win.webContents.send.mock.calls
        .filter((call): call is [R, AppEventsResponseMap[R]] => {
          return call[0] === channel;
        })
        .map(([, data]) => data);
    },
  };
}

/**
 * Live events like the connector's and the music service's: `on` and `off`
 * for the code under test, `emit` for the test.
 */
export function eventSource() {
  const events = new EventEmitter();
  return {
    on: vi.fn(
      <T extends TOKIO_EVENTS>(
        event: T,
        listener: (data: TokioEventMap[T]) => void,
      ) => {
        events.on(event, listener);
      },
    ),
    off: vi.fn(
      <T extends TOKIO_EVENTS>(
        event: T,
        listener: (data: TokioEventMap[T]) => void,
      ) => {
        events.off(event, listener);
      },
    ),
    emit<T extends TOKIO_EVENTS>(event: T, data: TokioEventMap[T]) {
      events.emit(event, data);
    },
    listeners: (event: TOKIO_EVENTS) => events.listenerCount(event),
  };
}
