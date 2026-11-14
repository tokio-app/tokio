// The lang of a voice that speaks every language its engine does
// (ElevenLabs', Fish Audio's). Intl names it "Multiple languages".
export const MULTILINGUAL = "mul";

// What a voice can be cloned from: each file extension's media type
export const VOICE_SAMPLE_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

// Each sample's most bytes, since most engines don't say their own limit
export const VOICE_SAMPLE_MAX_BYTES = 25 * 1024 * 1024;

// Samples one clone takes
export const VOICE_SAMPLES_MAX = 10;

// A cloned voice's name, in characters
export const VOICE_NAME_MAX = 100;
