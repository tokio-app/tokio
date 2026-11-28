import {
  type Alert,
  ALERT_TRIGGERS,
  AlertItemSchema,
  isRecord,
  MEDIA_DURATION,
  type MediaFile,
  type Profile,
  ProfileSchema,
  TriggerSchema,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  type AppEventsResponseMap,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  ALERT_MESSAGE_VARIABLES,
  createAlert,
  newRowTrigger,
  formatError,
  getAlertOverlayURL,
  samplePlatform,
} from "@/common/util";
import { saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import { importPictures, upload } from "@/helper/library";
import { z } from "zod";
import {
  type CallToolResult,
  activeProfile,
  checkPath,
  deepMerge,
  fail,
  guardProfile,
  invalid,
  invokeOk,
  ok,
  profileOf,
  pushProfile,
  refuseKeys,
  unknownTriggerKeys,
  PLATFORM_NOTE,
} from "../common";
import {
  defineKind,
  defineSection,
  defineTool,
  type Handler,
  type Kinds,
  READ,
  type Sections,
  type ToolDef,
  WRITE,
} from "../defs";

// The window plays MCP tests on the queue the pages' tests use, which an
// ALERT_CLEAR doesn't cut. The pages' own test hook only plays replies it
// numbered, so main pushes the audio itself.
const TEST_CHANNEL = "alert-test";

const AlertsSettingsSchema = ProfileSchema.shape.alerts
  .unwrap()
  .omit({ items: true })
  .strict();

// What save_item can change: the id is the alert's for good
const AlertChangesSchema = AlertItemSchema.omit({ id: true });

/**
 * Saves the alerts section through its handler, then sends the window the
 * profile. Called right after a guardProfile check: invoke runs before any
 * await.
 */
async function saveAlerts(handler: Handler, settings: Profile["alerts"]) {
  const { error } = await invokeOk(
    handler,
    APP_EVENTS.UPDATE_ALERTS_SETTINGS,
    { settings },
    APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS,
  );
  await pushProfile(handler);
  return error;
}

// The trigger's filters that narrow it, for a list row
const triggerSummary = ({
  type,
  gifts,
  every_gift,
  emotes,
  keyword,
  user,
  min_coins,
  roles,
  platform,
}: Alert["trigger"]) => ({
  type,
  ...(platform && { platform }),
  ...(gifts.length > 0 && { gifts }),
  ...(every_gift && { every_gift }),
  ...(emotes.length > 0 && { emotes }),
  ...(keyword && { keyword }),
  ...(user && { user }),
  ...(min_coins > 0 && { min_coins }),
  ...(roles.length > 0 && { roles }),
});

const fileOf = (entry: { name: string; file: string } | null) =>
  entry && { name: entry.name, file: entry.file };

const alertRow = (alert: Alert) => ({
  id: alert.id,
  name: alert.name,
  enabled: alert.enabled,
  trigger: triggerSummary(alert.trigger),
  also_triggers: alert.also_triggers.map(triggerSummary),
  sound: fileOf(alert.sound),
  message: alert.tts?.message ?? null,
  media: fileOf(alert.media),
});

/**
 * The alert `changes` make of `stored`. A sound or media file other than the
 * stored one starts over, as a pick in the editor does: the old cut,
 * duration and volume were for the old file. Names come from the library.
 */
function mergeAlert(
  stored: Alert,
  changes: Record<string, unknown>,
  sounds: MediaFile[],
  media: MediaFile[],
):
  | { error: CallToolResult; alert?: undefined }
  | { error?: undefined; alert: Alert } {
  const base = structuredClone(stored);
  for (const field of ["sound", "media"] as const) {
    const change = changes[field];
    if (
      isRecord(change) &&
      "file" in change &&
      change.file !== base[field]?.file
    ) {
      base[field] = null;
    }
  }
  const merged = deepMerge(base, changes);
  if (!isRecord(merged))
    return { error: fail("The changes must be an object.") };
  // A voice is replaced whole: merged, it would keep the last engine's id,
  // which the engines read first (tts.md)
  const voice = isRecord(changes.tts) ? changes.tts.voice : undefined;
  if (isRecord(voice) && isRecord(merged.tts)) {
    merged.tts.voice = { id: "", ...voice };
  }
  // Arrays replace: a new row has no stored gifts to merge onto
  if (Array.isArray(merged.also_triggers)) {
    merged.also_triggers = merged.also_triggers.map((row: unknown) =>
      isRecord(row) ? { gifts: [], ...row } : row,
    );
  }
  const { sound, media: shown } = merged;
  if (isRecord(sound)) {
    const listed = sounds.find((s) => s.file === sound.file);
    if (!listed) {
      return {
        error: fail(
          "That sound isn't in the sound library: list sounds, or add it with add_to_library.",
        ),
      };
    }
    merged.sound = { start: 0, end: null, ...sound, name: listed.name };
  }
  if (isRecord(shown)) {
    const listed = media.find((m) => m.file === shown.file);
    if (!listed) {
      return {
        error: fail(
          "That file isn't in the media library: list media, or add it with add_to_library.",
        ),
      };
    }
    merged.media = {
      start: 0,
      end: null,
      duration: MEDIA_DURATION,
      volume: 100,
      ...shown,
      name: listed.name,
    };
  }
  const parsed = AlertItemSchema.safeParse(merged);
  return parsed.success
    ? { alert: parsed.data }
    : { error: invalid(parsed.error) };
}

const VARIABLES = ALERT_TRIGGERS.map(
  (trigger) =>
    `${trigger}: ${ALERT_MESSAGE_VARIABLES[trigger].map((v) => `{${v}}`).join(" ") || "none"}`,
).join("; ");

// Pushes a test's audio, as AlertsService.handle sends a live alert's
function playTest(
  { win }: Handler,
  queueLength: number,
  audio: Omit<
    AppEventsResponseMap[APP_EVENTS_RESPONSE.ALERT_AUDIO],
    "channel" | "maxQueueLength"
  >,
) {
  if (win.isDestroyed()) return fail("Tokio's window is closed.");
  win.webContents.send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
    ...audio,
    channel: TEST_CHANNEL,
    maxQueueLength: queueLength,
  });
  return undefined;
}

export const sections: Sections = {
  alerts: defineSection({
    schema: AlertsSettingsSchema,
    read: async (handler) => {
      const profile = await profileOf(handler);
      const { simultaneous, queue_length } = profile.alerts;
      return { simultaneous, queue_length };
    },
    write: async (handler, values) => {
      // The read below waits: check again right before the invoke
      const changed = guardProfile(handler);
      const profile = await profileOf(handler);
      const error =
        changed() ??
        (await saveAlerts(handler, {
          simultaneous: values.simultaneous,
          queue_length: values.queue_length,
          items: profile.alerts.items,
        }));
      return error ?? ok("Saved.");
    },
    notes:
      "The active profile's alert settings; each alert is an item of the kind alert. simultaneous: alerts of different triggers play at once, each trigger on its own queue, instead of one after another. queue_length: the most alerts waiting per queue; more are dropped.",
  }),
};

export const kinds: Kinds = {
  alert: defineKind({
    schema: AlertChangesSchema,
    notes: [
      "An alert of the active profile: when its trigger, or any one of also_triggers (up to 4 more, each shaped like trigger), matches a LIVE event and it's enabled, it plays its sound, or speaks its tts message instead when tts is set, and shows its media on its own overlay (overlayURL, a browser source in OBS). An empty name shows as alert-<place>.",
      `trigger.type is one of: ${ALERT_TRIGGERS.join(", ")}. gifts (TikTok's gift ids from list gifts, empty for any) and every_gift are for gift triggers. min_coins is a trigger's minimum in its event's own unit, 0 for none: on ${TOKIO_EVENTS.GIFT}, only for any gift, the streak's worth when it ends (each gift's with every_gift) in TikTok's coins (YouTube's gifts have no price, so a min_coins above 0 never matches them, and Kick sends no gifts); on ${TOKIO_EVENTS.CHEER}, Bits; on ${TOKIO_EVENTS.KICKS}, Kick's Kicks; on ${TOKIO_EVENTS.SUPER_CHAT}, US dollars at the day's exchange rates (a Super Chat whose dollars aren't known, before the rates load or in a currency they lack, always matches); on ${TOKIO_EVENTS.GIFT_SUB}, the subs gifted at once. Other triggers ignore it. emotes (ids from list emotes, empty for any) for the emote trigger; keyword (whole words) for chat; user (a handle or name) for member and super fan joins; roles (follower, moderator, superfan, vip) only for chat, emote and gift: TikTok's say follower, moderator and superfan; Twitch's, YouTube's and Kick's chat and emotes say moderator and superfan (their subscribers or members), Twitch's and Kick's vip too, never follower, and their gifts none.`,
      `${PLATFORM_NOTE} Each of also_triggers has its own.`,
      "sound and media take a file from list sounds and list media ({ file } is enough; the name comes from the library). A sound plays from start to end seconds (end null: to its end); media shows for duration seconds (1–60), at least while the sound plays, and a video plays its cut at its own volume. Ask the streamer which sound or picture they want; add_to_library adds new ones. null clears one.",
      `tts: { voice, message, speed, pitch }, voice from list_voices ({ engine, name, lang, id }), replaced whole, so send all four. The message can hold its trigger's variables: ${VARIABLES}. {count} is a gift streak's total, or a like batch's likes. volume (0–100) is the sound's or message's.`,
    ].join("\n"),
    list: async (handler, { query, limit }) => {
      const profile = await profileOf(handler);
      const wanted = query?.toLowerCase();
      const found = profile.alerts.items.filter(
        (a) => !wanted || a.name.toLowerCase().includes(wanted),
      );
      return ok({
        total: found.length,
        alerts: found.slice(0, limit).map(alertRow),
      });
    },
    get: async (handler, id) => {
      const profile = await profileOf(handler);
      const alert = profile.alerts.items.find((a) => a.id === id);
      if (!alert) return fail(`No alert has the id ${id}.`);
      return ok({
        ...AlertItemSchema.parse(alert),
        overlayURL: getAlertOverlayURL(alert.id),
      });
    },
    save: async (handler, id, changes) => {
      const unknown = refuseKeys(unknownTriggerKeys(TriggerSchema, changes));
      if (unknown) return unknown;
      const changed = guardProfile(handler);
      const { storeManagerService } = handler;
      const profile = await profileOf(handler);
      const { items } = profile.alerts;
      const index =
        id === undefined ? items.length : items.findIndex((a) => a.id === id);
      if (index === -1) return fail(`No alert has the id ${id}.`);
      const { error: refused, alert } = mergeAlert(
        items[index] ?? createAlert(index, newRowTrigger(profile.platforms)),
        changes,
        storeManagerService.getSounds(),
        storeManagerService.getMedia(),
      );
      if (refused) return refused;
      const next =
        index === items.length
          ? [...items, alert]
          : items.map((a, i) => (i === index ? alert : a));
      const error =
        changed() ??
        (await saveAlerts(handler, { ...profile.alerts, items: next }));
      return (
        error ?? ok({ id: alert.id, overlayURL: getAlertOverlayURL(alert.id) })
      );
    },
    remove: async (handler, id) => {
      const changed = guardProfile(handler);
      const profile = await profileOf(handler);
      const { items } = profile.alerts;
      if (!items.some((a) => a.id === id)) {
        return fail(`No alert has the id ${id}.`);
      }
      const error =
        changed() ??
        (await saveAlerts(handler, {
          ...profile.alerts,
          items: items.filter((a) => a.id !== id),
        }));
      return error ?? ok("Removed.");
    },
    test: async (handler, id) => {
      const profile = await profileOf(handler);
      const alert = profile.alerts.items.find((a) => a.id === id);
      if (!alert) return fail(`No alert has the id ${id}.`);
      const { tts, sound, media, volume } = alert;
      if (!tts && !sound && !media) {
        return fail("The alert has no sound, message or media to test.");
      }
      const audio = { id: alert.id, volume, media: media ?? undefined };
      // Media alone takes its turn in the window's queue
      if (!tts && !sound) {
        return (
          playTest(handler, profile.alerts.queue_length, audio) ??
          ok("Showing its media.")
        );
      }
      // Read or spoken by the handler, so a missing file or a failed message
      // comes back here and in a notice
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.TEST_ALERT,
        {
          ...(tts
            ? {
                tts,
                trigger: alert.trigger.type,
                platform: samplePlatform(alert.trigger, profile.platforms),
              }
            : { file: sound!.file }),
          id: alert.id,
          request: 0,
          volume,
        },
        APP_EVENTS_RESPONSE.TEST_ALERT,
      );
      if (error) return error;
      return (
        playTest(handler, profile.alerts.queue_length, {
          ...audio,
          data: data.data,
          filters: data.filters,
          ...(!tts &&
            sound && {
              key: sound.file,
              start: sound.start,
              end: sound.end ?? undefined,
            }),
        }) ?? ok("Playing.")
      );
    },
  }),

  sounds: defineKind({
    notes:
      "The sound library, shared by every profile. The id is the file. Test plays one (or a MyInstants url from search_sounds, without an id). Removing one also takes it off every alert in every profile.",
    list: ({ storeManagerService }, { query, limit }) =>
      listLibrary(storeManagerService.getSounds(), "sounds", query, limit),
    remove: async (handler, id) => {
      if (!handler.storeManagerService.getSounds().some((s) => s.file === id)) {
        return fail(`No sound in the library has the file ${id}.`);
      }
      const { error } = await invokeOk(handler, APP_EVENTS.REMOVE_SOUND, {
        file: id,
      });
      return error ?? ok("Removed.");
    },
    testArgs: z.object({ url: z.string().optional() }).strict(),
    test: async (handler, id, { url }) => {
      if ((id === undefined) === (url === undefined)) {
        return fail("Give either the sound's id or a MyInstants url.");
      }
      const { storeManagerService } = handler;
      if (
        id !== undefined &&
        !storeManagerService.getSounds().some((s) => s.file === id)
      ) {
        return fail(`No sound in the library has the file ${id}.`);
      }
      const source = id !== undefined ? { file: id } : { url: url! };
      const key = id ?? url!;
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.TEST_ALERT,
        { ...source, id: key, request: 0, volume: 100 },
        APP_EVENTS_RESPONSE.TEST_ALERT,
      );
      if (error) return error;
      const profile = await activeProfile(handler);
      return (
        playTest(handler, profile?.alerts.queue_length ?? 100, {
          id: key,
          volume: 100,
          data: data.data,
          ...(id !== undefined && { key: id }),
        }) ?? ok("Playing.")
      );
    },
  }),

  media: defineKind({
    notes:
      "The image and video library for alerts, shared by every profile. The id is the file. Removing one also takes it off every alert in every profile and out of Overlay Studio.",
    list: ({ storeManagerService }, { query, limit }) =>
      listLibrary(storeManagerService.getMedia(), "media", query, limit),
    remove: async (handler, id) => {
      if (!handler.storeManagerService.getMedia().some((m) => m.file === id)) {
        return fail(`No file in the media library is ${id}.`);
      }
      const { error } = await invokeOk(handler, APP_EVENTS.REMOVE_MEDIA, {
        file: id,
      });
      return error ?? ok("Removed.");
    },
  }),

  gifts: defineKind({
    notes:
      "TikTok's gifts and the ones viewers sent that its list misses, cheapest first. A gift trigger takes their ids.",
    list: async ({ overlayService }, { query, limit }) => {
      const tiktok = await overlayService.getGifts();
      const listed = new Set(tiktok.map((g) => g.value));
      const custom = (await overlayService.getCustomGifts()).filter(
        (g) => !listed.has(g.value),
      );
      const wanted = query?.toLowerCase();
      const found = [...tiktok, ...custom]
        .filter((g) => !wanted || g.label.toLowerCase().includes(wanted))
        .sort((a, b) => a.coins - b.coins || a.label.localeCompare(b.label));
      return ok({
        total: found.length,
        gifts: found
          .slice(0, limit)
          .map((g) => ({ id: g.value, name: g.label, coins: g.coins })),
      });
    },
  }),

  emotes: defineKind({
    notes:
      "The emotes viewers used in the active profile's LIVEs (TikTok can't list them otherwise), oldest first. An emote trigger takes their ids.",
    list: async (handler, { query, limit }) => {
      const profile = await profileOf(handler);
      const found = profile.emotes.filter(
        (e) => !query || e.id.includes(query),
      );
      return ok({
        total: found.length,
        emotes: found.slice(0, limit).map((e) => ({ id: e.id })),
      });
    },
  }),
};

// Newest first, as the Library page shows them
function listLibrary(
  files: MediaFile[],
  field: string,
  query: string | undefined,
  limit: number,
) {
  const wanted = query?.toLowerCase();
  const found = files
    .filter((f) => !wanted || f.name.toLowerCase().includes(wanted))
    .reverse();
  return ok({
    total: found.length,
    [field]: found.slice(0, limit).map((f) => ({ id: f.file, name: f.name })),
  });
}

const LIBRARIES = ["sound", "media", "minecraft_picture"] as const;

const AddInput = z
  .object({
    kind: z.enum(LIBRARIES),
    url: z.string().optional(),
    name: z.string().min(1).optional(),
    path: z.string().optional(),
  })
  .strict();

// Adds a file from this computer to its library, then sends the window the
// list and the notice its handler would
async function addPath(
  handler: Handler,
  kind: (typeof LIBRARIES)[number],
  path: string,
): Promise<CallToolResult> {
  const { alertsService, storeManagerService, notifier, win } = handler;
  const send = <R extends APP_EVENTS_RESPONSE>(
    channel: R,
    data: AppEventsResponseMap[R],
  ) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  };

  if (kind === "minecraft_picture") {
    let res;
    try {
      res = await importPictures(handler, [path]);
    } catch (error) {
      return fail(`The picture wasn't added: ${formatError(error)}`);
    }
    send(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
      success: true,
      data: storeManagerService.getMinecraftPictures(),
    });
    if (!res.saved) return fail(saveFailure().message);
    const [picture] = res.pictures;
    notifier.success(
      "games",
      FEEDBACK_CODES.GAME_PICTURES_ADDED,
      t("main.games.pictureAdded", { name: picture.name }),
    );
    return ok({ id: picture.file, name: picture.name });
  }

  const sound = kind === "sound";
  const list = () =>
    sound ? storeManagerService.getSounds() : storeManagerService.getMedia();
  const reply = () =>
    send(
      sound ? APP_EVENTS_RESPONSE.GET_SOUNDS : APP_EVENTS_RESPONSE.GET_MEDIA,
      {
        success: true,
        data: list(),
      },
    );
  let res;
  try {
    res = await upload(
      [path],
      (p) =>
        sound ? alertsService.importSound(p) : alertsService.importMedia(p),
      {
        list,
        add: (files) =>
          sound
            ? storeManagerService.addSounds(files)
            : storeManagerService.addMediaFiles(files),
      },
    );
  } catch (error) {
    // The library couldn't be saved: main holds the file anyway
    reply();
    return fail(formatError(error));
  }
  const [entry] = res.imported;
  if (!entry)
    return fail(`The file wasn't added: ${res.error ?? "unknown error"}`);
  reply();
  if (res.added > 0) {
    notifier.success(
      "alerts",
      sound ? FEEDBACK_CODES.SOUND_ADDED : FEEDBACK_CODES.MEDIA_ADDED,
      t(sound ? "main.alerts.soundAdded" : "main.alerts.mediaAdded", {
        name: entry.name,
      }),
    );
  }
  return ok({ id: entry.file, name: entry.name, new: res.added > 0 });
}

export const tools: ToolDef<any>[] = [
  defineTool({
    name: "add_to_library",
    title: "Add to a library",
    description:
      "Adds a file to a library shared by every profile: a sound (mp3, wav, ogg) for alerts, an image or video (png, jpg, gif, webp, mp4, webm) for alerts' media, or a Minecraft picture (an image) for game actions. Give a `path` to a file on this computer, or for a sound a MyInstants `url` and its `name` from search_sounds. Returns the id to use in an alert or action.",
    input: AddInput,
    annotations: { ...WRITE, idempotentHint: true, openWorldHint: true },
    run: async (handler, { kind, url, name, path }) => {
      if ((url === undefined) === (path === undefined)) {
        return fail("Give either a path or a url.");
      }
      if (path !== undefined) {
        return (await checkPath(path)) ?? addPath(handler, kind, path);
      }
      if (kind !== "sound" || name === undefined) {
        return fail("Only sounds come from a url, with their name.");
      }
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.DOWNLOAD_SOUND,
        { id: "", request: 0, url: url!, name },
        APP_EVENTS_RESPONSE.SET_ALERT_SOUND,
      );
      // Its handler doesn't list them: the window's libraries get it here.
      // Also after a failed save, as main holds it.
      const { storeManagerService, win } = handler;
      if (!win.isDestroyed()) {
        win.webContents.send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
          success: true,
          data: storeManagerService.getSounds(),
        });
      }
      if (error) return error;
      return ok({ id: data.sound?.file, name: data.sound?.name });
    },
  }),
  defineTool({
    name: "search_sounds",
    title: "Search MyInstants",
    description:
      "Searches MyInstants for sounds, or lists its trending ones without a query, a page at a time. add_to_library adds one by its url and name; test with kind sounds plays one first. Sound names are written by MyInstants' users: viewer data.",
    input: z
      .object({
        query: z.string().optional(),
        page: z.number().int().min(1).optional(),
      })
      .strict(),
    annotations: { ...READ, openWorldHint: true },
    run: async ({ alertsService }, { query, page = 1 }) => {
      const res = query?.trim()
        ? await alertsService.search(query.trim(), page)
        : await alertsService.getTrending(page);
      if (!res.success || !res.data) {
        return fail(
          `MyInstants couldn't be searched: ${res.error ?? "unknown error"}`,
        );
      }
      return ok({
        page,
        hasNextPage: res.data.hasNextPage,
        sounds: res.data.sounds.map((s) => ({ name: s.name, url: s.url })),
      });
    },
  }),
];
