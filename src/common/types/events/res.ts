import { AboutInfo, LicenseText } from "../about";
import { MyInstantsSound } from "../alerts";
import { TokioPayload } from "../connector";
import { CustomGift, OverlayConfigRedux } from "../overlay";
import {
  Alert,
  AlertMedia,
  AlertSound,
  CatalogOverlay,
  MediaFile,
  OverlayConfig,
  Profile,
  SavedEmote,
  StoreSchema,
  TestOverlay,
} from "../../schemas";
import { AppNotification, Reply } from "../feedback";
import { LiveSession } from "../live";
import { OverlayApp } from "../server";
import { VoiceData, VoiceEngine } from "../store";
import { TimerData } from "../timer";
import { UpdateStatus } from "../updates";

type WindowState = { state: "normal" | "maximized" };

type AlertFilters = { speed: number; pitch: number };

export enum APP_EVENTS_RESPONSE {
  // INIT
  LOAD_APP = "app:load:res:all",

  // GLOBAL
  NOTIFY = "app:notify",
  TTS_AUDIO = "app:tts:audio",
  TTS_CLEAR = "app:tts:clear",

  // WINDOW
  RESIZE_WINDOW = "app:window:res:resize",
  RESIZE_MUSIC_WINDOW = "app:music:window:res:resize",

  // PROFILE
  GET_PROFILE = "app:profile:res",

  // VOICES
  GET_VOICES = "app:tts:res:voices",

  //TTS PAGE
  UPDATE_TTS_SETTINGS = "app:tts:res:update:settings",

  // TTS PAGE TESTER
  GET_TTS_TEST = "app:tts:res:test",

  //MUSIC PAGE
  UPDATE_MUSIC_SETTINGS = "app:music:res:update:settings",
  MUSIC_CONNECTED = "app:music:res:music:connected",

  // SETTINGS
  GET_SETTINGS = "app:settings:res",
  CREATE_PROFILE = "app:settings:res:create:profile",
  CLONE_PROFILE = "app:settings:res:clone:profile",
  IMPORT_ENTITY = "app:settings:res:import:entity",
  EXPORT_ENTITY = "app:settings:res:export:entity",
  SET_PROVIDER = "app:settings:res:set:provider",
  GET_VOICE_KEYS = "app:settings:res:voice-keys",
  SET_VOICE_KEY = "app:settings:res:set:voice-key",
  SET_SERVER = "app:settings:res:set:server",
  SET_AUTO_UPDATES = "app:settings:res:set:updates",
  REQ_FQDN = "app:settings:res:fqdn",
  GET_NETWORK_ADDRESSES = "app:settings:res:network",

  //HOME
  CONNECTED = "app:home:res:connect",
  VIEWS = "app:home:res:views",
  LIKES = "app:home:res:likes",
  LIVE_SESSION = "app:home:res:session",

  // OVERLAYS
  GET_OVERLAYS = "app:overlays:res:get",
  GET_OVERLAY_CONFIG = "app:overlays:res:get:config",
  SAVE_OVERLAY_CONFIG = "app:overlays:res:save:config",
  GET_GIFTS = "app:overlays:res:get:gifts",
  TEST_OVERLAY = "app:overlays:res:test",
  GET_OVERLAY_CATALOG = "app:overlays:res:get:catalog",
  INSTALL_OVERLAY = "app:overlays:res:install",

  // TOOLS
  GET_TEST_OVERLAYS = "app:tools:res:overlays:get",
  SEND_TEST_EVENTS = "app:tools:res:overlays:test",
  TIMER = "app:tools:res:timer",

  // ALERTS
  ALERT_AUDIO = "app:alerts:audio",
  ALERT_CLEAR = "app:alerts:clear",
  TEST_ALERT = "app:alerts:res:test",
  UPDATE_ALERTS_SETTINGS = "app:alerts:res:update:settings",
  SEARCH_SOUNDS = "app:alerts:res:search:sounds",
  SET_ALERT_SOUND = "app:alerts:res:set:sound",
  SET_ALERT_MEDIA = "app:alerts:res:set:media",
  ALERT_FILE_REMOVED = "app:alerts:res:file:removed",
  EMOTES = "app:alerts:res:emotes",
  CUSTOM_GIFTS = "app:alerts:res:gifts",

  // SOUND LIBRARY
  GET_SOUNDS = "app:sounds:res",

  // MEDIA LIBRARY
  GET_MEDIA = "app:media:res",

  // ABOUT
  GET_ABOUT = "app:about:res:get",
  GET_LICENSE_TEXT = "app:about:res:get:license",

  // UPDATES
  UPDATE_STATUS = "app:updates:res:status",
  CHECK_UPDATES = "app:updates:res:check",
}

export interface AppEventsResponseMap {
  // INIT
  [APP_EVENTS_RESPONSE.LOAD_APP]: Reply;

  // GLOBAL
  // Something the user should know about: failures, warnings, notices
  [APP_EVENTS_RESPONSE.NOTIFY]: AppNotification;

  [APP_EVENTS_RESPONSE.TTS_AUDIO]: {
    // Sent back with TTS_PLAYED once it's played or dropped
    id: number;
    data: Uint8Array;
    filters: Profile["tts"]["filters"];
    queueOptions: {
      gapTime: number;
      maxQueueLength: number;
    };
  };
  // Drops queued and playing chat TTS
  [APP_EVENTS_RESPONSE.TTS_CLEAR]: void;

  // WINDOW
  [APP_EVENTS_RESPONSE.RESIZE_WINDOW]: WindowState;

  [APP_EVENTS_RESPONSE.RESIZE_MUSIC_WINDOW]: WindowState;

  // PROFILE
  [APP_EVENTS_RESPONSE.GET_PROFILE]: Reply<{
    profile?: Profile;
    profiles?: { name: string; file: string }[];
  }>;

  //VOICES
  [APP_EVENTS_RESPONSE.GET_VOICES]: Reply<{
    voices?: VoiceData[];
    engines?: VoiceEngine[];
  }>;

  //TTS PAGE
  [APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS]: Reply;

  //TTS PAGE TESTER AND VOICE PREVIEWS
  [APP_EVENTS_RESPONSE.GET_TTS_TEST]: Reply<{
    id: string;
    data?: Uint8Array;
  }>;

  //MUSIC PAGE
  [APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS]: Reply;

  [APP_EVENTS_RESPONSE.MUSIC_CONNECTED]: Reply;

  // SETTINGS
  [APP_EVENTS_RESPONSE.GET_SETTINGS]: Reply<{
    data?: StoreSchema;
  }>;

  [APP_EVENTS_RESPONSE.CREATE_PROFILE]: Reply;

  [APP_EVENTS_RESPONSE.CLONE_PROFILE]: Reply;

  [APP_EVENTS_RESPONSE.IMPORT_ENTITY]: Reply<{
    type: "profile";
  }>;

  [APP_EVENTS_RESPONSE.EXPORT_ENTITY]: Reply<{
    type: "profile";
  }>;

  [APP_EVENTS_RESPONSE.SET_PROVIDER]: Reply<{
    type: "connector";
  }>;

  // Only the engines that take a key
  [APP_EVENTS_RESPONSE.GET_VOICE_KEYS]: Reply<{
    engines?: (VoiceEngine & { key: string })[];
  }>;

  [APP_EVENTS_RESPONSE.SET_VOICE_KEY]: Reply;

  [APP_EVENTS_RESPONSE.SET_SERVER]: Reply;

  [APP_EVENTS_RESPONSE.SET_AUTO_UPDATES]: Reply;

  [APP_EVENTS_RESPONSE.REQ_FQDN]: Reply;
  // This PC's IPv4 addresses, see ServerService.networkAddresses
  [APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES]: { addresses: string[] };

  // HOME
  [APP_EVENTS_RESPONSE.CONNECTED]: Reply<{
    stats: {
      views: number;
      viewers: number;
      likes: number;
    };
  }>;

  [APP_EVENTS_RESPONSE.VIEWS]: {
    data: {
      views: number;
      viewers: number;
    };
  };
  [APP_EVENTS_RESPONSE.LIKES]: {
    likes: number;
  };
  // The reply to GET_LIVE_SESSION, pushed again when the session changes
  [APP_EVENTS_RESPONSE.LIVE_SESSION]: {
    data: LiveSession;
  };

  // OVERLAYS
  [APP_EVENTS_RESPONSE.GET_OVERLAYS]: Reply<{
    data?: OverlayApp[];
  }>;
  // `id` is the overlay asked for, so a late reply for another is ignored
  [APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG]: Reply<{
    id: string;
    data?: OverlayConfig;
  }>;
  [APP_EVENTS_RESPONSE.GET_GIFTS]: {
    data: CustomGift[];
  };
  // `id` is the overlay saved, also when it fails
  [APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG]: Reply<{
    id: string;
    data?: OverlayConfigRedux;
  }>;
  [APP_EVENTS_RESPONSE.TEST_OVERLAY]: {
    payloads: TokioPayload[];
    id: string;
  };
  [APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG]: Reply<{
    data?: CatalogOverlay[];
  }>;
  // A successful install also replies GET_OVERLAYS with the new list.
  [APP_EVENTS_RESPONSE.INSTALL_OVERLAY]: Reply<{
    id: string;
  }>;

  // TOOLS
  // Adding and removing a test overlay also reply with the updated list.
  [APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS]: Reply<{
    data?: TestOverlay[];
  }>;
  // Fails when no overlay is connected with the id.
  [APP_EVENTS_RESPONSE.SEND_TEST_EVENTS]: Reply<{
    id: string;
  }>;
  // The active profile's countdown timer: GET_TIMER's reply, and pushed on
  // every change
  [APP_EVENTS_RESPONSE.TIMER]: Reply<{
    data?: TimerData;
  }>;

  // ALERTS
  [APP_EVENTS_RESPONSE.ALERT_AUDIO]: {
    // None when the alert only shows media
    data?: Uint8Array;
    volume: number;
    // Name of the renderer audio queue to play on
    channel: string;
    maxQueueLength: number;
    // Alert the sound belongs to, so volume changes reach it while playing,
    // and its media reaches its overlay
    id: string;
    // The same for every copy of the sound, so the window decodes it once.
    // Main always sets it with data, as the repeat's copies share its decode.
    key?: string;
    // A TTS alert's speed and pitch, for this sound only
    filters?: AlertFilters;
    // Shown on the alert's overlay when its turn comes
    media?: AlertMedia;
    // How many times it plays in a row, 1 when missing
    repeat?: number;
  };
  // Drops queued and playing alert sounds
  [APP_EVENTS_RESPONSE.ALERT_CLEAR]: void;
  [APP_EVENTS_RESPONSE.TEST_ALERT]: Reply<{
    id: string;
    data?: Uint8Array;
    volume: number;
    filters?: AlertFilters;
  }>;
  [APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS]: Reply;
  [APP_EVENTS_RESPONSE.SEARCH_SOUNDS]: Reply<{
    // Echo of the request, so stale responses can be dropped
    query: string;
    page: number;
    data: MyInstantsSound[];
    hasNextPage: boolean;
  }>;
  [APP_EVENTS_RESPONSE.SET_ALERT_SOUND]: Reply<{
    id: string;
    // The DOWNLOAD_SOUND or IMPORT_SOUND request this answers
    request: number;
    sound?: Alert["sound"];
  }>;
  [APP_EVENTS_RESPONSE.SET_ALERT_MEDIA]: Reply<{
    id: string;
    media?: MediaFile;
  }>;
  // A sound or media file deleted from its library, which main took off
  // every alert that had it
  [APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED]: {
    field: "sound" | "media";
    file: string;
  };
  // Pushed when a chat brings a new emote to the active profile
  [APP_EVENTS_RESPONSE.EMOTES]: {
    data: SavedEmote[];
  };
  // Gifts viewers sent that TikTok's list doesn't have. The reply to
  // GET_CUSTOM_GIFTS, pushed again when a LIVE brings a new one.
  [APP_EVENTS_RESPONSE.CUSTOM_GIFTS]: {
    data: CustomGift[];
  };

  // SOUND LIBRARY
  // success is false when the last upload or removal failed
  [APP_EVENTS_RESPONSE.GET_SOUNDS]: Reply<{
    data: AlertSound[];
  }>;

  // MEDIA LIBRARY
  // success is false when the last change failed
  [APP_EVENTS_RESPONSE.GET_MEDIA]: Reply<{
    data: MediaFile[];
  }>;

  // ABOUT
  [APP_EVENTS_RESPONSE.GET_ABOUT]: Reply<{
    data?: AboutInfo;
  }>;
  // `id` is the document asked for, also when it fails
  [APP_EVENTS_RESPONSE.GET_LICENSE_TEXT]: Reply<{
    id: string;
    data?: LicenseText;
  }>;

  // UPDATES
  // Also pushed whenever the status changes
  [APP_EVENTS_RESPONSE.UPDATE_STATUS]: UpdateStatus;
  [APP_EVENTS_RESPONSE.CHECK_UPDATES]: Reply;
}
