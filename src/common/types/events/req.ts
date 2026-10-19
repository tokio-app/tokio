import { AlertTrigger, TokioPayload } from "../connector";
import { CustomGift } from "../overlay";
import { AlertTts, OverlayConfig, Profile } from "../../schemas";
import { VoiceData } from "../store";

export enum APP_EVENTS {
  // INIT
  LOAD_APP = "app:load:all",

  // WINDOW
  MINIMIZE_WINDOW = "app:window:req:minimize",
  MAXIMIZE_WINDOW = "app:window:req:maximize",
  CLOSE_WINDOW = "app:window:req:close",
  SHOW_WINDOW = "app:window:req:show",

  MINIMIZE_MUSIC_WINDOW = "app:music:window:req:minimize",
  MAXIMIZE_MUSIC_WINDOW = "app:music:window:req:maximize",
  CLOSE_MUSIC_WINDOW = "app:music:window:req:close",

  // PROFILE
  GET_PROFILE = "app:profile:get",
  SET_PROFILE = "app:profile:set",

  // VOICES
  GET_VOICES = "app:tts:get:voices",

  //TTS PAGE
  UPDATE_TTS_SETTINGS = "app:tts:update:settings",

  // TTS PAGE TESTER
  GET_TTS_TEST = "app:tts:get:test",

  //MUSIC PAGE
  UPDATE_MUSIC_SETTINGS = "app:music:update:settings",
  CONNECT_MUSIC = "app:music:req:connect",
  DISCONNECT_MUSIC = "app:music:req:disconnect",
  IS_MUSIC_CONNECTED = "app:music:req:is:connected",

  // SETTINGS
  GET_SETTINGS = "app:settings:get",
  CREATE_PROFILE = "app:settings:create:profile",
  CLONE_PROFILE = "app:settings:clone:profile",
  IMPORT_ENTITY = "app:settings:import:entity",
  EXPORT_ENTITY = "app:settings:export:entity",
  SET_PROVIDER = "app:settings:set:provider",
  GET_VOICE_KEYS = "app:settings:get:voice-keys",
  SET_VOICE_KEY = "app:settings:set:voice-key",
  SET_SERVER = "app:settings:set:server",
  SET_AUTO_UPDATES = "app:settings:set:updates",
  REQ_FQDN = "app:settings:req:fqdn",

  // HOME
  CONNECT = "app:home:connect",
  DISCONNECT = "app:home:disconnect",
  IS_CONNECTED = "app:home:isconnected",
  ACTIVE_FEATURES = "app:home:activefeatures",

  // OVERLAYS
  IMPORT_OVERLAY = "app:overlays:add",
  GET_OVERLAYS = "app:overlays:get",
  GET_OVERLAY_CONFIG = "app:overlays:get:config",
  SAVE_OVERLAY_CONFIG = "app:overlays:save:config",
  GET_GIFTS = "app:overlays:get:gifts",
  SEND_OVERLAY_DATA = "app:overlays:send:data",
  TEST_OVERLAY = "app:overlays:test",
  REMOVE_OVERLAY = "app:overlays:remove",
  GET_OVERLAY_CATALOG = "app:overlays:get:catalog",
  INSTALL_OVERLAY = "app:overlays:install",

  // TOOLS
  GET_TEST_OVERLAYS = "app:tools:overlays:get",
  ADD_TEST_OVERLAY = "app:tools:overlays:add",
  REMOVE_TEST_OVERLAY = "app:tools:overlays:remove",
  SEND_TEST_EVENTS = "app:tools:overlays:test",

  // ALERTS
  UPDATE_ALERTS_SETTINGS = "app:alerts:update:settings",
  SEARCH_SOUNDS = "app:alerts:search:sounds",
  DOWNLOAD_SOUND = "app:alerts:download:sound",
  IMPORT_SOUND = "app:alerts:import:sound",
  TEST_ALERT = "app:alerts:test",

  // SOUND LIBRARY
  GET_SOUNDS = "app:sounds:get",
  UPLOAD_SOUNDS = "app:sounds:upload",
  REMOVE_SOUND = "app:sounds:remove",

  // ABOUT
  GET_ABOUT = "app:about:get",
  GET_LICENSE_TEXT = "app:about:get:license",

  // UPDATES
  GET_UPDATE_STATUS = "app:updates:get",
  CHECK_UPDATES = "app:updates:check",
  INSTALL_UPDATE = "app:updates:install",
}

export interface AppEventsMap {
  // INIT
  [APP_EVENTS.LOAD_APP]: void;

  // WINDOW
  [APP_EVENTS.MINIMIZE_WINDOW]: void;
  [APP_EVENTS.MAXIMIZE_WINDOW]: void;
  [APP_EVENTS.CLOSE_WINDOW]: void;
  [APP_EVENTS.SHOW_WINDOW]: void;

  [APP_EVENTS.MINIMIZE_MUSIC_WINDOW]: void;
  [APP_EVENTS.MAXIMIZE_MUSIC_WINDOW]: void;
  [APP_EVENTS.CLOSE_MUSIC_WINDOW]: void;

  // PROFILE
  [APP_EVENTS.GET_PROFILE]: void;
  [APP_EVENTS.SET_PROFILE]: { file: string };

  //VOICES
  [APP_EVENTS.GET_VOICES]: void;

  //TTS PAGE
  [APP_EVENTS.UPDATE_TTS_SETTINGS]: {
    settings: Profile["tts"];
  };

  //TTS PAGE TESTER AND VOICE PREVIEWS
  [APP_EVENTS.GET_TTS_TEST]: {
    // Echoed in the response, so each listener knows its own tests
    id: string;
    text: string;
    voice: VoiceData;
  };

  //MUSIC PAGE
  [APP_EVENTS.UPDATE_MUSIC_SETTINGS]: {
    settings: Profile["music"];
  };

  [APP_EVENTS.CONNECT_MUSIC]: {
    name: string;
    key: string;
  };

  [APP_EVENTS.DISCONNECT_MUSIC]: void;
  [APP_EVENTS.IS_MUSIC_CONNECTED]: void;

  // SETTINGS
  [APP_EVENTS.GET_SETTINGS]: void;

  [APP_EVENTS.CREATE_PROFILE]: {
    name: string;
  };

  [APP_EVENTS.CLONE_PROFILE]: {
    name: string;
    ref: string;
  };

  [APP_EVENTS.IMPORT_ENTITY]: {
    type: "profile";
  };

  [APP_EVENTS.EXPORT_ENTITY]: {
    type: "profile";
    file: string;
  };

  [APP_EVENTS.SET_PROVIDER]: {
    name: string;
    key: string;
    type: "connector";
  };

  [APP_EVENTS.GET_VOICE_KEYS]: void;

  [APP_EVENTS.SET_VOICE_KEY]: {
    engine: string;
    key: string;
  };

  [APP_EVENTS.SET_SERVER]: {
    enabled: boolean;
  };

  [APP_EVENTS.SET_AUTO_UPDATES]: {
    enabled: boolean;
  };

  [APP_EVENTS.REQ_FQDN]: void;

  // HOME
  [APP_EVENTS.CONNECT]: {
    username: string;
  };
  [APP_EVENTS.DISCONNECT]: void;
  [APP_EVENTS.IS_CONNECTED]: void;
  [APP_EVENTS.ACTIVE_FEATURES]: {
    tts?: boolean;
    music?: boolean;
    alerts?: boolean;
  };

  // OVERLAYS
  [APP_EVENTS.IMPORT_OVERLAY]: void;
  [APP_EVENTS.GET_OVERLAYS]: void;
  [APP_EVENTS.GET_OVERLAY_CONFIG]: { id: string };
  [APP_EVENTS.GET_GIFTS]: void;
  [APP_EVENTS.SAVE_OVERLAY_CONFIG]: {
    id: string;
    config: OverlayConfig;
    gifts: CustomGift[];
  };
  [APP_EVENTS.SEND_OVERLAY_DATA]: {
    id: string;
    payload: TokioPayload;
  };
  [APP_EVENTS.TEST_OVERLAY]: {
    id: string;
  };
  [APP_EVENTS.REMOVE_OVERLAY]: { id: string };
  [APP_EVENTS.GET_OVERLAY_CATALOG]: void;
  // Installs the catalog's version of an official overlay, or updates the
  // installed one
  [APP_EVENTS.INSTALL_OVERLAY]: { id: string };

  // TOOLS
  [APP_EVENTS.GET_TEST_OVERLAYS]: void;
  [APP_EVENTS.ADD_TEST_OVERLAY]: { name: string };
  [APP_EVENTS.REMOVE_TEST_OVERLAY]: { id: string };
  [APP_EVENTS.SEND_TEST_EVENTS]: { id: string };

  // ALERTS
  [APP_EVENTS.UPDATE_ALERTS_SETTINGS]: {
    settings: Profile["alerts"];
  };
  [APP_EVENTS.SEARCH_SOUNDS]: {
    // Without a query, trending sounds are returned.
    query?: string;
    page: number;
  };
  [APP_EVENTS.DOWNLOAD_SOUND]: {
    id: string;
    url: string;
    name: string;
  };
  [APP_EVENTS.IMPORT_SOUND]: {
    id: string;
  };
  // A TTS test speaks the message filled with a sample of the trigger
  [APP_EVENTS.TEST_ALERT]: (
    | { file: string }
    | { url: string }
    | { tts: AlertTts; trigger: AlertTrigger }
  ) & {
    volume: number;
    // Identifies the test: the alert id, or the url for previews
    id: string;
  };

  // SOUND LIBRARY
  [APP_EVENTS.GET_SOUNDS]: void;
  [APP_EVENTS.UPLOAD_SOUNDS]: void;
  [APP_EVENTS.REMOVE_SOUND]: {
    file: string;
  };

  // ABOUT
  [APP_EVENTS.GET_ABOUT]: void;
  // A document or package id from GET_ABOUT
  [APP_EVENTS.GET_LICENSE_TEXT]: { id: string };

  // UPDATES
  [APP_EVENTS.GET_UPDATE_STATUS]: void;
  [APP_EVENTS.CHECK_UPDATES]: void;
  // Restarts into the downloaded update, or opens the release page on macOS
  [APP_EVENTS.INSTALL_UPDATE]: void;
}
