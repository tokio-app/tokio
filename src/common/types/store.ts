export type Provider = { name: string; active: boolean; key: string };

// engine is the id of the TTS engine (provider) that speaks the voice.
export type VoiceData = {
  engine: string;
  name: string;
  lang: string;
};

// keyLabel is set when the engine takes a key, e.g. TikTok's session ID.
export type VoiceEngine = { id: string; label: string; keyLabel?: string };

export interface Folders {
  appFolder: string;
  settingsFolder: string;
  logsFolder: string;
  overlaysFolder: string;
  profilesFolder: string;
  extraFolder: string;
  soundsFolder: string;
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
  };
  gifts: string;
  customGifts: string;
}
