import { ProfileSchema } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { MULTILINGUAL } from "@/common/util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, invalid, invokeOk, ok, pushProfile } from "../common";
import {
  defineKind,
  defineSection,
  defineTool,
  type Handler,
  type Kinds,
  READ,
  type Sections,
  type ToolDef,
} from "../defs";

const Tts = ProfileSchema.shape.tts;
const Voice = Tts.shape.voice.strict();

// The saved schema, with the ranges the TTS page's fields keep
const TtsSection = Tts.extend({
  filters: z
    .object({
      speed: z.number().min(0.5).max(2),
      pitch: z.number().min(0.5).max(2),
      volume: z.number().min(0).max(100),
    })
    .strict(),
  protection: Tts.shape.protection.extend({
    cooldown: z.number().min(0),
    queue_length: z.number().int().min(1),
    comment_length: z.number().int().min(1),
  }),
}).strict();

const VOICE_LIMIT = 50;
const VOICE_MAX = 200;

const profileOf = async ({ storeManagerService }: Handler) => {
  const profile = await storeManagerService.getProfileData();
  if (!profile) throw new Error("The active profile couldn't be read.");
  return profile;
};

export const sections: Sections = {
  tts: defineSection({
    schema: TtsSection,
    read: async (handler) => Tts.parse((await profileOf(handler)).tts),
    write: async (handler, values, changes) => {
      // A voice is replaced whole: one picked without an id mustn't keep the
      // last voice's, which the profile's deep merge would (tts.md)
      let voice = values.voice;
      if (changes.voice !== undefined) {
        const parsed = Voice.safeParse(changes.voice);
        if (!parsed.success) return invalid(parsed.error);
        voice = parsed.data;
      }
      const { error } = await invokeOk(
        handler,
        APP_EVENTS.UPDATE_TTS_SETTINGS,
        { settings: { ...values, voice: { ...voice, id: voice.id ?? "" } } },
        APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS,
      );
      // Also after a failed save: the TTS page shows what main holds
      await pushProfile(handler);
      return error ?? ok("Saved.");
    },
    notes: [
      "Chat text-to-speech for the active profile. Only chat messages are read here; alerts have their own spoken messages.",
      "voice: the voice chat is read in, { engine, name, lang, id } exactly as list_voices gives it. It's replaced whole, so send all four.",
      "filters: speed and pitch 0.5-2 (1 is normal), volume 0-100.",
      "permissions: who is read. all lets everyone; otherwise followers, superfans, moderators, or a minimum level (level.enabled, level.value). With list.enabled, handles in list.black are never read and a non-empty list.white alone decides.",
      "format.template: what's read, with the variables {username}, {handle}, {comment} and {translation}. format.trigger: mode any reads every message; dot, slash and custom read only messages starting with value ('.', '/', or a custom command such as '!tts'), which is cut off. remove_emojis leaves emojis out. translate reads the chat translation in {comment}'s place, when chat translation is on (app section).",
      "protection: cooldown seconds between messages, queue_length messages waiting at most, comment_length characters read at most, banned words that stop a message.",
      "replacements: whole words replaced before reading ({ old, new }).",
      "user_voices: special users, { handle, voice } each: chat from that handle is read in that voice.",
      "Engine keys are set with set_key, and voice_engines lists which engines have one.",
    ].join("\n"),
  }),
};

export const kinds: Kinds = {
  voice: defineKind({
    notes:
      "test reads `text` aloud in Tokio as chat would be (banned words, replacements, the profile's speed, pitch and volume), in `voice` or else the profile's voice. No id.",
    testArgs: z
      .object({ text: z.string().min(1).max(500), voice: Voice.optional() })
      .strict(),
    test: async (handler, _id, { text, voice }) => {
      const { tts } = await profileOf(handler);
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.GET_TTS_TEST,
        { id: randomUUID(), text, voice: voice ?? tts.voice, settings: tts },
        APP_EVENTS_RESPONSE.GET_TTS_TEST,
      );
      if (error) return error;
      if (!data.data) return fail("The engine returned no audio.");
      const { win } = handler;
      if (win.isDestroyed()) return fail("Tokio's window is closed.");
      // GET_TTS_TEST is private: the window plays it as an alert test
      win.webContents.send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
        data: data.data,
        volume: tts.filters.volume,
        channel: "alert-test",
        maxQueueLength: 10,
        id: "mcp:voice-test",
        // tts: keys aren't kept decoded once played
        key: `tts:mcp:${randomUUID()}`,
        filters: { speed: tts.filters.speed, pitch: tts.filters.pitch },
      });
      return ok("Playing it in Tokio.");
    },
  }),
  voice_engines: defineKind({
    notes:
      "The voice engines that take an API key, and whether one is set. set_key sets or removes it.",
    list: ({ ttsService, storeManagerService }) =>
      ok({
        engines: ttsService
          .getEngines()
          .filter((engine) => engine.keyLabel)
          .map(({ id, label }) => ({
            id,
            label,
            hasKey: storeManagerService.getVoiceKey(id) !== "",
          })),
      }),
  }),
};

const ListVoicesInput = z
  .object({
    engine: z.string().optional(),
    language: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(VOICE_MAX).optional(),
  })
  .strict();

export const tools: ToolDef<any>[] = [
  defineTool({
    name: "list_voices",
    title: "List voices",
    description: `Lists the voices of every engine, ${VOICE_LIMIT} by default: \`engine\` is an engine id, \`language\` a language tag prefix (such as es or en-US; multilingual voices, lang "${MULTILINGUAL}", match every language), \`query\` part of the name. Use a row as the tts section's voice. \`failedEngines\` couldn't list theirs, often for a missing or wrong key.`,
    input: ListVoicesInput,
    annotations: { ...READ, openWorldHint: true },
    run: async (
      { ttsService },
      { engine, language, query, limit = VOICE_LIMIT },
    ) => {
      const failed: string[] = [];
      const voices = await ttsService.getVoices((id, error) => {
        failed.push(id);
        ttsService.logVoicesFailure(id, error);
      });
      const lang = language?.toLowerCase();
      const name = query?.toLowerCase();
      const found = voices.filter(
        (v) =>
          (!engine || v.engine === engine) &&
          (!lang ||
            v.lang === MULTILINGUAL ||
            v.lang.toLowerCase().startsWith(lang)) &&
          (!name || v.name.toLowerCase().includes(name)),
      );
      return ok({
        total: found.length,
        voices: found.slice(0, limit).map((v) => ({
          engine: v.engine,
          id: v.id ?? "",
          name: v.name,
          lang: v.lang,
        })),
        failedEngines: failed,
      });
    },
  }),
];
