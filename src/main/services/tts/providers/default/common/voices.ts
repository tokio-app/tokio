import { ProviderVoice } from "../../../common";
import { EnglishVoiceName, SpanishVoiceName } from "../types";

const EnglishVoicesData: Record<EnglishVoiceName, string> = {
  Default: "en_us_001",
  "Game On": "en_male_jomboy",
  Jessie: "en_us_002",
  Wacky: "en_male_funny",
  Scream: "en_us_ghostface",
  Empathetic: "en_female_samc",
  Serious: "en_male_cody",
  "Beauty Guru": "en_female_makeup",
  Bestie: "en_female_richgirl",
  Trickster: "en_male_grinch",
  Joey: "en_us_006",
  "Story Teller": "en_male_narration",
  "Mr. GoodGuy": "en_male_deadpool",
  Narrator: "en_uk_001",
  "Male English UK": "en_uk_003",
  Metro: "en_au_001",
  Alfred: "en_male_jarvis",
  ashmagic: "en_male_ashmagic",
  olantekkers: "en_male_olantekkers",
  "Lord Cringe": "en_male_ukneighbor",
  "Mr. Meticulous": "en_male_ukbutler",
  Debutante: "en_female_shenna",
  Varsity: "en_female_pansino",
  Marty: "en_male_trevor",
  "Pop Lullaby": "en_female_f08_twinkle",
  "Classic Electric": "en_male_m03_classical",
  Bae: "en_female_betty",
  Cupid: "en_male_cupid",
  Granny: "en_female_grandma",
  Cozy: "en_male_m2_xhxs_m03_christmas",
  Author: "en_male_santa_narration",
  Caroler: "en_male_sing_deep_jingle",
  Santa: "en_male_santa_effect",
  "NYE 2023": "en_female_ht_f08_newyear",
  Magician: "en_male_wizard",
  Opera: "en_female_ht_f08_halloween",
  Euphoric: "en_female_ht_f08_glorious",
  Hypetrain: "en_male_sing_funny_it_goes_up",
  Melodrama: "en_female_ht_f08_wonderful_world",
  "Quirky Time": "en_male_m2_xhxs_m03_silly",
  Peaceful: "en_female_emotional",
  "Toon Beat": "en_male_m03_sunshine_soon",
  "Open Mic": "en_female_f08_warmy_breeze",
  Jingle: "en_male_m03_lobby",
  Thanksgiving: "en_male_sing_funny_thanksgiving",
  Cottagecore: "en_female_f08_salut_damour",
  Professor: "en_us_007",
  Scientist: "en_us_009",
  Confidence: "en_us_010",
  Smooth: "en_au_002",
} as const;

const SpanishVoicesData: Record<SpanishVoiceName, string> = {
  Pedro: "es_002",
  Juan: "es_mx_002",
} as const;

export const VoicesData: Record<EnglishVoiceName | SpanishVoiceName, string> = {
  ...EnglishVoicesData,
  ...SpanishVoicesData,
};

const Voices: ProviderVoice[] = [];

for (const voice of Object.keys(EnglishVoicesData)) {
  Voices.push({ name: voice, lang: "en" });
}

for (const voice of Object.keys(SpanishVoicesData)) {
  Voices.push({ name: voice, lang: "es" });
}

export { Voices };
