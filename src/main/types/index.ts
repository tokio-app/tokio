import type { MessageKey } from "@/common/i18n";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  AppEventsMap,
  AppEventsResponseMap,
  FeedbackSource,
} from "@/common/types";
import type { Notifier } from "@/helper/feedback";
import { AlertsService } from "@/services/alerts";
import { ConnectorService } from "@/services/connector";
import { ControlsService } from "@/services/controls";
import { FansService } from "@/services/fans";
import { GamesService } from "@/services/games";
import { HistoryService } from "@/services/history";
import { JSONManagerService } from "@/services/json";
import { LicensesService } from "@/services/licenses";
import { LiveService } from "@/services/live";
import { MusicService } from "@/services/music";
import { OverlayService } from "@/services/overlay";
import { PathManagerService } from "@/services/path";
import { ServerService } from "@/services/server";
import { StoreManagerService } from "@/services/store";
import { StudioService } from "@/services/studio";
import { TimerService } from "@/services/timer";
import { TranslationService } from "@/services/translation";
import { TrayService } from "@/services/tray";
import { TTSService } from "@/services/tts";
import { UpdaterService } from "@/services/updater";
import { URLManagerService } from "@/services/url";
import { YAMLManagerService } from "@/services/yaml";
import {
  App,
  BrowserWindow,
  IpcMain,
  session as Session,
  Shell,
  WebContents,
} from "electron";

type TypedWebContents = Omit<WebContents, "send"> & {
  send: <T extends APP_EVENTS_RESPONSE>(
    channel: T,
    args: AppEventsResponseMap[T],
  ) => void;
};

export type CustomBrowserWindow = Omit<BrowserWindow, "webContents"> & {
  webContents: TypedWebContents;
};

export interface AppServices {
  readonly connectorService: ConnectorService;
  readonly ttsService: TTSService;
  readonly musicService: MusicService;
  readonly serverService: ServerService;
  readonly overlayService: OverlayService;
  readonly urlManagerService: URLManagerService;
  readonly jsonManagerService: JSONManagerService;
  readonly storeManagerService: StoreManagerService;
  readonly pathManagerService: PathManagerService;
  readonly yamlManagerService: YAMLManagerService;
  readonly alertsService: AlertsService;
  readonly licensesService: LicensesService;
  readonly updaterService: UpdaterService;
  readonly liveService: LiveService;
  readonly timerService: TimerService;
  readonly fansService: FansService;
  readonly historyService: HistoryService;
  readonly gamesService: GamesService;
  readonly studioService: StudioService;
  readonly trayService: TrayService;
  readonly translationService: TranslationService;
  readonly controlsService: ControlsService;
}

export interface AppHandlerVariables extends AppServices {
  readonly app: App;
  readonly win: CustomBrowserWindow;
  // Closed once the main window shows
  readonly splash: BrowserWindow;
  readonly ipcMain: IpcMain;
  readonly shell: Shell;
  readonly session: typeof Session;
  readonly notifier: Notifier;
  // Runs a request's handler in main, as if the window had sent it. A void
  // request still needs undefined as its data.
  readonly invoke: Invoke;
}

// All a handler gets of the event, so it can run without the window too
// (Handler.invoke). Electron's IpcMainEvent is one.
export type ReplyEvent = {
  reply: <T extends APP_EVENTS_RESPONSE>(
    event: T,
    args: AppEventsResponseMap[T],
  ) => void;
};

// A reply as a [channel, data] pair
export type SentReply = {
  [T in APP_EVENTS_RESPONSE]: [T, AppEventsResponseMap[T]];
}[APP_EVENTS_RESPONSE];

export interface InvokeResult {
  // What the handler reported when it threw
  error?: AppError;
  // The replies sent before it finished, oldest first
  replies: SentReply[];
}

export type Invoke = <K extends APP_EVENTS>(
  event: K,
  data: AppEventsMap[K],
) => Promise<InvokeResult>;

export type EventCallback<K extends APP_EVENTS> = (
  handler: AppHandlerVariables,
  event: ReplyEvent,
  data: AppEventsMap[K],
) => void | Promise<void>;

export interface EventOptions<K extends APP_EVENTS> {
  // Where failures are logged and reported, the stack's source by default
  source?: FeedbackSource;
  // Reported when the handler throws something other than an AppFailure. Its
  // message is a key, translated when it's reported.
  failure?: Omit<AppError, "message"> & { message: MessageKey };
  // Sends the page's failure reply
  onError?: (
    event: ReplyEvent,
    error: AppError,
    data: AppEventsMap[K],
    handler: AppHandlerVariables,
  ) => void;
  // false when the page already shows the failure, true by default
  notify?: boolean;
}

export interface EventItem<K extends APP_EVENTS> {
  event: K;
  callback: EventCallback<K>;
  options: EventOptions<K>;
}
