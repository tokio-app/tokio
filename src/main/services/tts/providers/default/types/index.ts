export interface TTSResponse {
  data: TTSResponseData;
  extra: { log_id: string };
  message: string;
  status_code: number;
  status_msg: string;
}

export interface TTSResponseALT {
  data: string;
  success: boolean;
  error: string;
}

export type TTSResponseData = {
  s_key: string;
  v_str: string;
  duration: string;
  speaker: string;
};

export type SupportedLanguage = "en" | "es";

export type EnglishVoiceName =
  | "Default"
  | "Game On"
  | "Jessie"
  | "Wacky"
  | "Scream"
  | "Empathetic"
  | "Serious"
  | "Beauty Guru"
  | "Bestie"
  | "Trickster"
  | "Joey"
  | "Story Teller"
  | "Mr. GoodGuy"
  | "Narrator"
  | "Male English UK"
  | "Metro"
  | "Alfred"
  | "ashmagic"
  | "olantekkers"
  | "Lord Cringe"
  | "Mr. Meticulous"
  | "Debutante"
  | "Varsity"
  | "Marty"
  | "Pop Lullaby"
  | "Classic Electric"
  | "Bae"
  | "Cupid"
  | "Granny"
  | "Cozy"
  | "Author"
  | "Caroler"
  | "Santa"
  | "NYE 2023"
  | "Magician"
  | "Opera"
  | "Euphoric"
  | "Hypetrain"
  | "Melodrama"
  | "Quirky Time"
  | "Peaceful"
  | "Toon Beat"
  | "Open Mic"
  | "Jingle"
  | "Thanksgiving"
  | "Cottagecore"
  | "Professor"
  | "Scientist"
  | "Confidence"
  | "Smooth";

export type SpanishVoiceName = "Pedro" | "Juan";
