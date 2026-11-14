export type VoicesResponse = {
  voices: { voiceId: string; displayName: string; languageCode?: string }[];
  nextPageToken?: string;
};

export type SpeakResponse = {
  // Base64
  audioContent?: string;
};

// A gRPC status code, which the HTTP status repeats
export type ErrorResponse = { code?: number; message?: string };

// Without a voice, the samples' errors say why
export type CloneResponse = {
  voice?: { voiceId?: string };
  audioSamplesValidated?: { errors?: { text?: string }[] }[];
};
