export type SapiEngine = "sapi" | "onecore";

export type SapiRequest =
  | { type: "voices" }
  | {
      type: "speak";
      text: string;
      voice?: string;
      engine?: SapiEngine;
      rate: number;
      volume: number;
    };

export type SapiResponse = {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type SapiResponseMap = {
  voices: SapiVoice[];
  speak: string;
};

export type SapiVoice = {
  name: string;
  lang: string;
  engine: SapiEngine;
};
