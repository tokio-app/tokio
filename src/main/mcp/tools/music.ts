import { Profile, ProfileSchema } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { z } from "zod";
import {
  type CallToolResult,
  fail,
  invokeOk,
  ok,
  permissionsNote,
  profileOf,
  pushProfile,
} from "../common";
import {
  defineKind,
  defineSection,
  defineTool,
  type Handler,
  type Kinds,
  type Sections,
  type ToolDef,
  WRITE,
} from "../defs";

const Music = ProfileSchema.shape.music;

// The saved schema without the Spotify Client ID (set_key's), with the
// ranges the Music page's fields keep
const MusicSettings = Music.extend({
  provider: Music.shape.provider.omit({ key: true }),
  protection: Music.shape.protection.extend({
    cooldown: z.number().min(0),
    queue_length: z.number().int().min(1),
  }),
});

// Song titles are viewers' requests: viewer data
export const queueOf = ({ musicService }: Handler) =>
  musicService
    .songs()
    .map(({ title, playing, played }) => ({ title, playing, played }));

export const sections: Sections = {
  music: defineSection({
    schema: MusicSettings.strict(),
    read: async (handler) =>
      MusicSettings.parse((await profileOf(handler)).music),
    info: async (handler) => ({
      hasKey: (await profileOf(handler)).music.provider.key !== "",
    }),
    write: async (handler, values) => {
      const { error } = await invokeOk(
        handler,
        APP_EVENTS.UPDATE_MUSIC_SETTINGS,
        // Without the key: the profile's deep merge keeps the saved one
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only provider.key is missing
        { settings: values as Profile["music"] },
        APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS,
      );
      // Also after a failed save: the Music page shows what main holds
      await pushProfile(handler);
      return error ?? ok("Saved.");
    },
    notes: [
      "Song requests from chat for the active profile. They work only with the music feature on (features section) and the player connected (the music tool's connect).",
      "provider.name: YouTube or Spotify, used on the next connect. hasKey says whether Spotify's Client ID is set; set_key sets it.",
      "provider.block_ads: YouTube's ad blocker. Before turning it on, tell the user that blocking YouTube's ads breaks YouTube's Terms of Service and may stop playback, and turn it on only if they agree. Turning it off needs no warning.",
      "controls: play, next, last and revoke, each { enabled, command } (a chat command such as !play). play and revoke take a song after the command.",
      permissionsNote("who may use them", "are refused"),
      "protection: cooldown seconds between commands from anyone, queue_length songs waiting at most, one_per_viewer one waiting request per viewer and no song twice, limit_controls lets only the host and moderators use next, last and revoke on others' songs.",
    ].join("\n"),
  }),
};

export const kinds: Kinds = {
  music_queue: defineKind({
    notes:
      "The songs requested this session, in order, with the one playing. Titles are viewers' requests.",
    list: (handler, { query, limit }) => {
      const wanted = query?.toLowerCase();
      const found = queueOf(handler).filter(
        (song) => !wanted || song.title.toLowerCase().includes(wanted),
      );
      return ok({
        connected: handler.musicService.isActive(),
        total: found.length,
        songs: found.slice(0, limit),
      });
    },
  }),
};

const ACTIONS = [
  "request",
  "revoke",
  "previous",
  "connect",
  "disconnect",
] as const;

const MusicInput = z
  .object({
    action: z.enum(ACTIONS),
    query: z.string().min(1).max(200).optional(),
  })
  .strict();

// What each action runs, giving an error result or whether it was taken
const RUN: Record<
  (typeof ACTIONS)[number],
  (
    handler: Handler,
    query: string,
  ) => boolean | Promise<boolean | CallToolResult>
> = {
  request: ({ musicService, connectorService }, query) =>
    musicService.request(query, connectorService.username),
  revoke: ({ musicService }, query) => musicService.revoke(query),
  previous: ({ musicService }) => musicService.previous(),
  connect: async (handler) => {
    const { name, key, block_ads } = (await profileOf(handler)).music.provider;
    // Not awaited: Spotify waits for the streamer to log in, which would hold
    // every other MCP write. The handler's notices report a failure.
    handler
      .invoke(APP_EVENTS.CONNECT_MUSIC, { name, key, block_ads })
      .catch((error: unknown) =>
        Logger.error(
          `<MCP> Unable to connect the music player -- ${formatError(error)}`,
          handler.pathManagerService.files?.logs.system,
          error,
        ),
      );
    return ok({
      connecting: true,
      message:
        "The player is connecting. Check get_status or list music_queue for the connection.",
    });
  },
  disconnect: async (handler) => {
    // Its reply says success: false, for not connected
    const { error } = await invokeOk(
      handler,
      APP_EVENTS.DISCONNECT_MUSIC,
      undefined,
    );
    return error ?? true;
  },
};

export const tools: ToolDef<any>[] = [
  defineTool({
    name: "music",
    title: "Music player",
    description:
      "Drives song requests as the host, with no chat permissions or cooldown. request searches `query` and queues it (it shows in the queue once found, in a few seconds); revoke takes every waiting request for `query` (its text or the song's title) out; previous plays the last song again; to skip the song playing, use control skip_song. request needs the music feature on and the player connected. connect starts opening the profile's player (YouTube or Spotify, see the music section) and returns at once with `connecting: true`: Spotify waits for the streamer to log in, so check get_status or list music_queue for the connection; disconnect closes it. The other actions return whether it was done and the queue, whose titles are viewer data.",
    input: MusicInput,
    annotations: { ...WRITE, openWorldHint: true },
    run: async (handler, { action, query }) => {
      if ((action === "request" || action === "revoke") && !query) {
        return fail(`${action} needs a query.`);
      }
      if (action === "request") {
        // The next chat's clearHandler would drop it with music off
        if (!handler.storeManagerService.getActiveFeatures().music) {
          return fail(
            "The music feature is off. Turn it on in the features section first.",
          );
        }
        if (!handler.musicService.isActive()) {
          return fail("The player isn't connected. Connect it first.");
        }
      }
      const done = await RUN[action](handler, query ?? "");
      if (typeof done === "object") return done;
      return ok({
        done,
        connected: handler.musicService.isActive(),
        queue: queueOf(handler),
      });
    },
  }),
];
