import { AboutInfo, LicenseText } from "../about";
import { MyInstantsSound } from "../alerts";
import { TokioPayload } from "../connector";
import { CustomGift, OverlayConfigRedux } from "../overlay";
import {
  Alert,
  AlertSound,
  OverlayConfig,
  Profile,
  SavedEmote,
  StoreSchema,
  TestOverlay,
} from "../../schemas";
import { AppNotification, Reply } from "../feedback";
import { OverlayApp } from "../server";
import { VoiceData, VoiceEngine } from "../store";
import { UpdateStatus } from "../updates";

type WindowState = { state: "normal" | "maximized" };

export enum APP_EVENTS_RESPONSE {
  // INIT
  LOAD_APP = "app:load:res:all",

  // GLOBAL
  NOTIFY = "app:notify",
  TTS_AUDIO = "app:tts:audio",

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

  //HOME
  CONNECTED = "app:home:res:connect",
  VIEWS = "app:home:res:views",
  LIKES = "app:home:res:likes",

  // OVERLAYS
  GET_OVERLAYS = "app:overlays:res:get",
  GET_OVERLAY_CONFIG = "app:overlays:res:get:config",
  SAVE_OVERLAY_CONFIG = "app:overlays:res:save:config",
  GET_GIFTS = "app:overlays:res:get:gifts",
  TEST_OVERLAY = "app:overlays:res:test",

  // TOOLS
  GET_TEST_OVERLAYS = "app:tools:res:overlays:get",
  SEND_TEST_EVENTS = "app:tools:res:overlays:test",

  // ALERTS
  ALERT_AUDIO = "app:alerts:audio",
  ALERT_CLEAR = "app:alerts:clear",
  TEST_ALERT = "app:alerts:res:test",
  UPDATE_ALERTS_SETTINGS = "app:alerts:res:update:settings",
  SEARCH_SOUNDS = "app:alerts:res:search:sounds",
  SET_ALERT_SOUND = "app:alerts:res:set:sound",
  EMOTES = "app:alerts:res:emotes",

  // SOUND LIBRARY
  GET_SOUNDS = "app:sounds:res",

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
    data: Uint8Array<ArrayBufferLike>;
    filters: Profile["tts"]["filters"];
    queueOptions: {
      gapTime: number;
      maxQueueLength: number;
    };
  };

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

  //TTS PAGE TESTER
  [APP_EVENTS_RESPONSE.GET_TTS_TEST]: Reply<{
    data?: Uint8Array<ArrayBufferLike>;
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

  // OVERLAYS
  [APP_EVENTS_RESPONSE.GET_OVERLAYS]: Reply<{
    data?: OverlayApp[];
  }>;
  [APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG]: Reply<{
    data?: OverlayConfig;
  }>;
  [APP_EVENTS_RESPONSE.GET_GIFTS]: {
    data: CustomGift[];
  };
  [APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG]: Reply<{
    data?: OverlayConfigRedux;
    id?: string;
  }>;
  [APP_EVENTS_RESPONSE.TEST_OVERLAY]: {
    payloads: TokioPayload[];
    id: string;
  };

  // TOOLS
  // Adding and removing a test overlay also reply with the updated list.
  [APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS]: Reply<{
    data?: TestOverlay[];
  }>;
  // Fails when no overlay is connected with the id.
  [APP_EVENTS_RESPONSE.SEND_TEST_EVENTS]: Reply<{
    id: string;
  }>;

  // ALERTS
  [APP_EVENTS_RESPONSE.ALERT_AUDIO]: {
    data: Uint8Array;
    volume: number;
    // Name of the renderer audio queue to play on
    channel: string;
    maxQueueLength: number;
    // Alert the sound belongs to, so volume changes reach it while playing
    id?: string;
  };
  // Drops queued and playing alert sounds
  [APP_EVENTS_RESPONSE.ALERT_CLEAR]: void;
  [APP_EVENTS_RESPONSE.TEST_ALERT]: Reply<{
    id: string;
    data?: Uint8Array;
    volume: number;
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
    sound?: Alert["sound"];
  }>;
  // Pushed when a chat brings a new emote to the active profile
  [APP_EVENTS_RESPONSE.EMOTES]: {
    data: SavedEmote[];
  };

  // SOUND LIBRARY
  // success is false when the last upload or removal failed
  [APP_EVENTS_RESPONSE.GET_SOUNDS]: Reply<{
    data: AlertSound[];
  }>;

  // ABOUT
  [APP_EVENTS_RESPONSE.GET_ABOUT]: Reply<{
    data?: AboutInfo;
  }>;
  [APP_EVENTS_RESPONSE.GET_LICENSE_TEXT]: Reply<{
    data?: LicenseText;
  }>;

  // UPDATES
  // Also pushed whenever the status changes
  [APP_EVENTS_RESPONSE.UPDATE_STATUS]: UpdateStatus;
  [APP_EVENTS_RESPONSE.CHECK_UPDATES]: Reply;
}
