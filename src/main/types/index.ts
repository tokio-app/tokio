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
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { LicensesService } from "@/services/licenses";
import { LiveService } from "@/services/live";
import { MusicService } from "@/services/music";
import { OverlayService } from "@/services/overlay";
import { PathManagerService } from "@/services/path";
import { ServerService } from "@/services/server";
import { StoreManagerService } from "@/services/store";
import { TimerService } from "@/services/timer";
import { TrayService } from "@/services/tray";
import { TTSService } from "@/services/tts";
import { UpdaterService } from "@/services/updater";
import { URLManagerService } from "@/services/url";
import { YAMLManagerService } from "@/services/yaml";
import {
  App,
  BrowserWindow,
  IpcMain,
  IpcMainEvent,
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
  readonly connectorService: TikTokConnectorService;
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
  readonly trayService: TrayService;
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
}

export type ReplyEvent = Omit<IpcMainEvent, "reply"> & {
  reply: <T extends APP_EVENTS_RESPONSE>(
    event: T,
    args: AppEventsResponseMap[T],
  ) => void;
};

export type EventCallback<K extends APP_EVENTS> = (
  handler: AppHandlerVariables,
  event: ReplyEvent,
  data: AppEventsMap[K],
) => void | Promise<void>;

export interface EventOptions<K extends APP_EVENTS> {
  // Where failures are logged and reported, the stack's source by default
  source?: FeedbackSource;
  // Reported when the handler throws something other than an AppFailure
  failure?: AppError;
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
