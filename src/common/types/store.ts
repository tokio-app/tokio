import type { MessageKey } from "../i18n";

// engine is the id of the TTS engine (provider) that speaks the voice. id is
// the engine's own id for it, set when its names can repeat or change
// (ElevenLabs): the engine gets it instead of the name, which is only shown.
export type VoiceData = {
  engine: string;
  name: string;
  lang: string;
  id?: string;
};

// keyLabel is set when the engine takes a key, e.g. TikTok's session ID: the
// key of its name, translated where it's shown. clones is set when it can
// clone a voice from samples.
export type VoiceEngine = {
  id: string;
  label: string;
  keyLabel?: MessageKey;
  clones?: boolean;
};

// An audio file or a recording to clone a voice from: its file name, which
// names its format, and its bytes
export type VoiceSample = { name: string; data: Uint8Array };

export interface Folders {
  appFolder: string;
  settingsFolder: string;
  logsFolder: string;
  overlaysFolder: string;
  profilesFolder: string;
  extraFolder: string;
  soundsFolder: string;
  mediaFolder: string;
  // Each game's own folder sits in games/
  minecraftFolder: string;
  fansFolder: string;
  historyFolder: string;
}

export interface Files {
  logs: {
    connector: string;
    tts: string;
    system: string;
    server: string;
    alerts: string;
    music: string;
    overlays: string;
    games: string;
  };
  gifts: string;
  customGifts: string;
}
