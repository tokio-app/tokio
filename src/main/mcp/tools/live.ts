import { APP_EVENTS, APP_EVENTS_RESPONSE, ControlAction } from "@/common/types";
import { z } from "zod";
import { invokeOk, ok } from "../common";
import {
  defineKind,
  defineTool,
  type Kinds,
  type Sections,
  type ToolDef,
  WRITE,
} from "../defs";

export const sections: Sections = {};

export const kinds: Kinds = {
  profiles: defineKind({
    notes:
      "The id is the profile's file. Each profile keeps its own TTS, music, alerts and games settings; the profile tool switches them.",
    list: ({ storeManagerService }, { query, limit }) => {
      const active = storeManagerService.getSettings().activeProfile.file;
      const wanted = query?.toLowerCase();
      const found = storeManagerService
        .getProfiles()
        .filter((p) => !wanted || p.name.toLowerCase().includes(wanted));
      return ok({
        total: found.length,
        profiles: found.slice(0, limit).map((p) => ({
          id: p.file,
          name: p.name,
          active: p.file === active,
        })),
      });
    },
  }),
};

const ACTIONS = [
  "skip_song",
  "stop_tts",
  "replay_alert",
  "pause",
  "resume",
] as const;

// What each control runs, as the phone remote's buttons do
const CONTROLS: Record<
  (typeof ACTIONS)[number],
  { action: ControlAction; paused?: boolean }
> = {
  skip_song: { action: "skipSong" },
  stop_tts: { action: "stopTts" },
  replay_alert: { action: "replayAlert" },
  pause: { action: "pause", paused: true },
  resume: { action: "pause", paused: false },
};

const ControlInput = z.object({ action: z.enum(ACTIONS) }).strict();

export const tools: ToolDef<any>[] = [
  defineTool({
    name: "control",
    title: "Live controls",
    description:
      "skip_song skips the song playing (a waiting request plays next, else the player's own Next). stop_tts stops the chat message being read. replay_alert plays the last LIVE event's alerts again. pause holds TTS, alerts, song requests and game actions until resume; the music plays on, and nothing from the pause plays later. `done` is false when there was nothing to do.",
    input: ControlInput,
    annotations: WRITE,
    run: async (handler, { action }) => {
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.CONTROL,
        CONTROLS[action],
        APP_EVENTS_RESPONSE.CONTROL,
      );
      return error ?? ok({ done: data.done, paused: data.paused });
    },
  }),
];
