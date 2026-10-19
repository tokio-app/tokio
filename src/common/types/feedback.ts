// Stable codes for what happened, so the UI can react to a code without
// parsing messages. Failures end in _FAILED, successes are in the past tense.
export enum FEEDBACK_CODES {
  UNKNOWN = "unknown",

  // SYSTEM
  APP_LOADED = "app_loaded",
  PROFILE_CREATED = "profile_created",
  PROFILE_CLONED = "profile_cloned",
  PROFILE_SWITCHED = "profile_switched",
  PROFILE_IMPORTED = "profile_imported",
  PROFILE_EXPORTED = "profile_exported",
  PROVIDER_UPDATED = "provider_updated",
  APP_LOAD_FAILED = "app_load_failed",
  SETTINGS_LOAD_FAILED = "settings_load_failed",
  SETTINGS_SAVE_FAILED = "settings_save_failed",
  PROFILE_LOAD_FAILED = "profile_load_failed",
  PROFILE_SAVE_FAILED = "profile_save_failed",
  PROFILE_CREATE_FAILED = "profile_create_failed",
  PROFILE_CLONE_FAILED = "profile_clone_failed",
  PROFILE_LOCKED = "profile_locked",
  PROFILE_EXISTS = "profile_exists",
  PROFILE_IMPORT_FAILED = "profile_import_failed",
  PROFILE_EXPORT_FAILED = "profile_export_failed",
  PROVIDER_UPDATE_FAILED = "provider_update_failed",
  FQDN_INSTALL_FAILED = "fqdn_install_failed",
  ABOUT_LOAD_FAILED = "about_load_failed",
  LICENSE_LOAD_FAILED = "license_load_failed",

  // UPDATES
  UPDATE_AVAILABLE = "update_available",
  UPDATE_READY = "update_ready",
  UPDATES_ENABLED = "updates_enabled",
  UPDATES_DISABLED = "updates_disabled",
  UPDATE_CHECK_FAILED = "update_check_failed",
  UPDATE_DOWNLOAD_FAILED = "update_download_failed",
  UPDATE_INSTALL_FAILED = "update_install_failed",

  // SERVER
  SERVER_STARTED = "server_started",
  SERVER_STOPPED = "server_stopped",
  SERVER_START_FAILED = "server_start_failed",

  // CONNECTOR
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  LIVE_ENDED = "live_ended",
  CONNECT_FAILED = "connect_failed",
  DISCONNECT_FAILED = "disconnect_failed",
  FEATURES_UPDATE_FAILED = "features_update_failed",

  // TTS
  TTS_VOICES_FAILED = "tts_voices_failed",
  TTS_GENERATION_FAILED = "tts_generation_failed",
  TTS_TEST_BLOCKED = "tts_test_blocked",

  // MUSIC
  MUSIC_CONNECTED = "music_connected",
  MUSIC_DISCONNECTED = "music_disconnected",
  MUSIC_CONNECT_FAILED = "music_connect_failed",
  MUSIC_DISCONNECT_FAILED = "music_disconnect_failed",
  MUSIC_PLAYBACK_FAILED = "music_playback_failed",

  // OVERLAYS
  OVERLAY_IMPORTED = "overlay_imported",
  OVERLAY_INSTALLED = "overlay_installed",
  OVERLAY_UPDATED = "overlay_updated",
  OVERLAY_SAVED = "overlay_saved",
  OVERLAY_REMOVED = "overlay_removed",
  TEST_OVERLAY_ADDED = "test_overlay_added",
  TEST_OVERLAY_REMOVED = "test_overlay_removed",
  OVERLAYS_LOAD_FAILED = "overlays_load_failed",
  OVERLAY_IMPORT_FAILED = "overlay_import_failed",
  OVERLAY_CATALOG_FAILED = "overlay_catalog_failed",
  OVERLAY_INSTALL_FAILED = "overlay_install_failed",
  OVERLAY_UPDATE_FAILED = "overlay_update_failed",
  OVERLAY_CONFIG_FAILED = "overlay_config_failed",
  OVERLAY_SAVE_FAILED = "overlay_save_failed",
  OVERLAY_REMOVE_FAILED = "overlay_remove_failed",
  OVERLAY_SEND_FAILED = "overlay_send_failed",
  GIFTS_FETCH_FAILED = "gifts_fetch_failed",
  TEST_OVERLAY_FAILED = "test_overlay_failed",

  // ALERTS
  SOUND_ADDED = "sound_added",
  SOUNDS_UPLOADED = "sounds_uploaded",
  SOUND_REMOVED = "sound_removed",
  ALERT_FAILED = "alert_failed",
  ALERT_SOUND_MISSING = "alert_sound_missing",
  ALERT_TTS_FAILED = "alert_tts_failed",
  SOUNDS_LOAD_FAILED = "sounds_load_failed",
  SOUND_SEARCH_FAILED = "sound_search_failed",
  SOUND_DOWNLOAD_FAILED = "sound_download_failed",
  SOUND_IMPORT_FAILED = "sound_import_failed",
  SOUND_READ_FAILED = "sound_read_failed",
  SOUND_REMOVE_FAILED = "sound_remove_failed",
  EMOTES_SAVE_FAILED = "emotes_save_failed",
  GIFTS_SAVE_FAILED = "gifts_save_failed",
}

export type FeedbackLevel = "success" | "info" | "warning" | "error";

// Same keys as the log files, so a source also picks where it's logged.
export type FeedbackSource =
  "system" | "connector" | "server" | "tts" | "alerts" | "music" | "overlays";

export interface AppError {
  code: FEEDBACK_CODES;
  // Readable text for the user, details stay in the logs
  message: string;
}

// Pushed by main on APP_EVENTS_RESPONSE.NOTIFY
export interface AppNotification {
  id: string;
  level: FeedbackLevel;
  source: FeedbackSource;
  code?: FEEDBACK_CODES;
  message: string;
  timestamp: number;
}

// Shape of every response that reports success, with the reason when it fails.
export type Reply<T extends object = object> = T & {
  success: boolean;
  error?: AppError;
};
