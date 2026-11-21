import { APP_LANGUAGES } from "@/common/i18n";
import { ActivityFeedSchema, ShortcutsSchema } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { TRANSLATION_LANGUAGES } from "@/common/util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type CallToolResult,
  fail,
  invokeOk,
  ok,
  pushSettings,
} from "../common";
import {
  defineKind,
  defineSection,
  type Handler,
  type Kinds,
  type Sections,
  type ToolDef,
} from "../defs";

const LANGUAGES = ["system", ...APP_LANGUAGES.map(({ tag }) => tag)];
const TRANSLATIONS = ["", ...TRANSLATION_LANGUAGES];

const AppSchema = z
  .object({
    language: z.enum(LANGUAGES),
    translation: z.enum(TRANSLATIONS),
    tray: z.boolean(),
    updates: z.boolean(),
    overlay_updates: z.boolean(),
    detailed_logs: z.boolean(),
  })
  .strict();
type AppValues = z.output<typeof AppSchema>;

// Each field through its own handler, as Settings saves them one at a time
const SAVE_APP: Record<
  keyof AppValues,
  (handler: Handler, values: AppValues) => Promise<{ error?: CallToolResult }>
> = {
  language: (h, v) =>
    invokeOk(h, APP_EVENTS.SET_LANGUAGE, { language: v.language }),
  translation: (h, v) =>
    invokeOk(h, APP_EVENTS.SET_TRANSLATION, { language: v.translation }),
  tray: (h, v) => invokeOk(h, APP_EVENTS.SET_TRAY, { enabled: v.tray }),
  updates: (h, v) =>
    invokeOk(h, APP_EVENTS.SET_AUTO_UPDATES, { enabled: v.updates }),
  overlay_updates: (h, v) =>
    invokeOk(h, APP_EVENTS.SET_OVERLAY_UPDATES, {
      enabled: v.overlay_updates,
    }),
  detailed_logs: (h, v) =>
    invokeOk(h, APP_EVENTS.SET_LOGS, { enabled: v.detailed_logs }),
};

const isAppField = (key: string): key is keyof AppValues =>
  Object.hasOwn(SAVE_APP, key);

const textOf = ({ content }: CallToolResult) =>
  content.map((c) => (c.type === "text" ? c.text : "")).join("");

// Keys that may stand alone: macro pads and Stream Deck hotkeys send them
const ALONE =
  /^(F1[3-9]|F2[0-4]|MediaNextTrack|MediaPreviousTrack|MediaPlayPause|MediaStop|VolumeUp|VolumeDown|VolumeMute)$/;
const KEY =
  /^(F[1-9]|F1\d|F2[0-4]|num\d|numadd|numsub|nummult|numdiv|numdec|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Space|\d|[A-Z])$/;
const MODIFIERS = new Set([
  "Ctrl",
  "Control",
  "Alt",
  "Shift",
  "Command",
  "Super",
]);

/**
 * Why an accelerator can't be a global shortcut, by the recorder's rules
 * (toAccelerator in the renderer): main saves any string, and one like "A"
 * would take that key from every app.
 */
export function shortcutProblem(
  accelerator: string,
  mac = process.platform === "darwin",
): string | undefined {
  if (accelerator === "") return undefined;
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts);
  if (mods.size !== parts.length || parts.some((m) => !MODIFIERS.has(m))) {
    return "its modifiers must be Ctrl, Alt, Shift, Super, or on macOS Control and Command, each once";
  }
  if (ALONE.test(key)) return undefined;
  if (!KEY.test(key)) return `${key} can't be a shortcut's key`;
  const ctrl =
    mods.has("Ctrl") || (mac && (mods.has("Control") || mods.has("Command")));
  if (!ctrl || mods.size < 2) {
    return "it needs two modifiers, one of them Ctrl (⌘ or ⌃ on macOS), so the key keeps working in other apps";
  }
  // AltGr is Ctrl+Alt there, and types @ and € on many layouts
  if (!mac && mods.has("Ctrl") && mods.has("Alt") && !mods.has("Shift")) {
    return "Ctrl+Alt without Shift is AltGr on Windows and Linux";
  }
  return undefined;
}

export const sections: Sections = {
  features: defineSection({
    schema: z
      .object({ tts: z.boolean(), music: z.boolean(), alerts: z.boolean() })
      .strict(),
    read: ({ storeManagerService }) => {
      const { tts, music, alerts } = storeManagerService.getActiveFeatures();
      return { tts, music, alerts };
    },
    write: async (handler, values) => {
      const { error } = await invokeOk(handler, APP_EVENTS.ACTIVE_FEATURES, {
        tts: values.tts,
        music: values.music,
        alerts: values.alerts,
      });
      // Its handler replies nothing. Also after a failed save: the window
      // shows what main holds.
      pushSettings(handler);
      return error ?? ok("Saved.");
    },
    notes:
      "Home's switches, the same for every profile. Turning one off stops what it's playing: tts the chat messages being read, alerts the alerts, music the song requests waiting.",
  }),

  activity_feed: defineSection({
    schema: ActivityFeedSchema.strict(),
    read: ({ storeManagerService }) => ({
      ...storeManagerService.getSettings().activityFeed,
    }),
    write: async (handler, values) => {
      const { error } = await invokeOk(handler, APP_EVENTS.SET_ACTIVITY_FEED, {
        feed: values,
      });
      // Its handler replies only the feed
      pushSettings(handler);
      return error ?? ok("Saved.");
    },
    notes:
      "The kinds of events Home's activity feed keeps, for every profile. Hiding one drops its items already in the feed; they still count toward the LIVE's totals. sub, giftsub, cheer, raid and redeem come from Twitch.",
  }),

  app: defineSection({
    schema: AppSchema,
    read: ({ storeManagerService }) => {
      const s = storeManagerService.getSettings();
      return {
        // A language Tokio no longer has is applied as its fallback
        language: LANGUAGES.includes(s.language) ? s.language : "system",
        translation: TRANSLATIONS.includes(s.translation.language)
          ? s.translation.language
          : "",
        tray: s.tray.enabled,
        updates: s.updates.auto,
        overlay_updates: s.overlayUpdates.auto,
        detailed_logs: s.logs.debug,
      };
    },
    write: async (handler, values, changes) => {
      const saved: string[] = [];
      // update_settings refused any other key
      for (const field of Object.keys(changes).filter(isAppField)) {
        const { error } = await SAVE_APP[field](handler, values);
        if (error) {
          return saved.length === 0
            ? error
            : fail(
                `Saved ${saved.join(", ")}, but not ${field}: ${textOf(error)}`,
              );
        }
        saved.push(field);
      }
      // Their handlers reply the settings
      return ok("Saved.");
    },
    notes: [
      `language: Tokio's own language, "system" to follow the computer's, or one of ${APP_LANGUAGES.map((l) => `${l.tag} (${l.name})`).join(", ")}.`,
      'translation: the language chat messages are translated to, for TTS, alerts and overlays ({translation}), or "" for off. Google translates them: ask the streamer before turning it on.',
      "tray: closing the window keeps Tokio running in the tray. updates: checks for Tokio's new versions. overlay_updates: installs new versions of the official overlays (not breaking ones). detailed_logs: also logs each LIVE event, for bug reports; the logs grow faster.",
    ].join("\n"),
  }),

  shortcuts: defineSection({
    schema: ShortcutsSchema.unwrap().strict(),
    read: ({ storeManagerService }) => {
      const { skipSong, stopTts, replayAlert, pause } =
        storeManagerService.getSettings().shortcuts;
      return { skipSong, stopTts, replayAlert, pause };
    },
    write: async (handler, values) => {
      const problems = Object.entries(values).flatMap(
        ([action, accelerator]) => {
          const problem = shortcutProblem(accelerator);
          return problem ? [`${action} (${accelerator}): ${problem}`] : [];
        },
      );
      if (problems.length > 0) {
        return fail(`Nothing was saved:\n${problems.join("\n")}`);
      }
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.SET_SHORTCUTS,
        {
          shortcuts: {
            skipSong: values.skipSong,
            stopTts: values.stopTts,
            replayAlert: values.replayAlert,
            pause: values.pause,
          },
        },
        APP_EVENTS_RESPONSE.SET_SHORTCUTS,
      );
      // Its handler replies the settings
      return error ?? ok({ saved: true, takenByAnotherApp: data.taken });
    },
    notes:
      'Global shortcuts for the live controls, as Electron accelerators such as "Ctrl+Shift+S" ("" is none). They work in every app, so each needs Ctrl and another modifier (Ctrl+Alt alone is refused on Windows and Linux), except F13–F24 and the media keys, which can stand alone. takenByAnotherApp lists the ones another app holds. Ask the streamer which keys to use.',
  }),
};

export const kinds: Kinds = {
  translation: defineKind({
    notes:
      "test translates `text` as a chat message would be, to the app section's translation language: it can stay as typed (a command), be already in that language, or be translated.",
    testArgs: z.object({ text: z.string().trim().min(1) }).strict(),
    test: async (handler, _id, { text }) => {
      if (
        handler.storeManagerService.getSettings().translation.language === ""
      ) {
        return fail(
          "Chat translation is off: set the app section's translation first.",
        );
      }
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.TEST_TRANSLATION,
        { id: randomUUID(), text },
        APP_EVENTS_RESPONSE.TEST_TRANSLATION,
      );
      if (error) return error;
      const res = data.data;
      if (!res) return fail("Tokio didn't translate it.");
      switch (res.kind) {
        case "command":
          return ok({ kind: "command", note: "A command, kept as typed." });
        case "same":
          return ok({ kind: "same", from: res.from });
        default:
          return ok({
            kind: "translated",
            translation: res.translation.text,
            from: res.translation.from,
            to: res.translation.to,
          });
      }
    },
  }),
};

export const tools: ToolDef<any>[] = [];
