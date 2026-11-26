import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
  PLATFORMS,
} from "@/common/types";
import { PLATFORM_TRIGGERS } from "@/common/util";
import { profileReply, replySettings } from "@/events/pages/settings";
import type { AppHandlerVariables } from "@/types";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";

export { deepMerge } from "@/services/shared";
export type { CallToolResult };

/** What a trigger's platform means, for the alert and game action kinds. */
export const PLATFORM_NOTE = `trigger.platform (${PLATFORMS.join(" or ")}) takes only that platform's events; left out, any platform's. What each one sends: ${PLATFORMS.map((p) => `${p}: ${PLATFORM_TRIGGERS[p].join(", ")}`).join("; ")}. On redeem, keyword is the reward's title (empty for any).`;

// The permissions field, the same on the tts and music sections
export const permissionsNote = (who: string, refused: string) =>
  `permissions: ${who}. The base fields are TikTok's: all lets everyone; otherwise followers, superfans, moderators, or a minimum level (level.enabled, level.value). platforms holds Twitch's, YouTube's and Kick's own rules, each { all, superfans (their subscribers or members), moderators, vips (Twitch's and Kick's VIPs) }, and one left out lets everyone. The lists apply on every platform: with list.enabled, handles in list.black ${refused} and a non-empty list.white alone decides.`;

// How long a write waits for the window's FLUSH_SETTINGS answer
export const FLUSH_MS = 1000;

/** A result holding `value`: a sentence as it is, anything else as JSON. */
export const ok = (value: unknown): CallToolResult => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

/** An error result. `message` is the handler's AppError.message or English. */
export const fail = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

// FLUSH_SETTINGS ids the window hasn't answered, with what ends the wait
const flushing = new Map<string, () => void>();

/**
 * Asks the window to send the saves its pages still wait to make, and
 * resolves once it answers, after FLUSH_MS, or when the window closes. IPC
 * from one window arrives in order, so those saves reach main first.
 */
export function flushWindow({ win }: AppHandlerVariables): Promise<void> {
  if (win.isDestroyed()) return Promise.resolve();
  const id = randomUUID();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      flushing.delete(id);
      win.off("closed", done);
      resolve();
    };
    const timer = setTimeout(done, FLUSH_MS);
    flushing.set(id, done);
    win.once("closed", done);
    win.webContents.send(APP_EVENTS_RESPONSE.FLUSH_SETTINGS, { id });
  });
}

/** The window's SETTINGS_FLUSHED: ends that flush's wait. */
export const settingsFlushed = (id: string) => flushing.get(id)?.();

// The last write, so the next one starts once it's done
let writing: Promise<unknown> = Promise.resolve();

/**
 * Runs every MCP write one at a time, each after the window flushed what its
 * pages still had to save, so a page's late save can't undo the write.
 */
export function write<T>(
  handler: AppHandlerVariables,
  fn: () => T | Promise<T>,
): Promise<T> {
  const run = writing.then(async () => {
    await flushWindow(handler);
    return fn();
  });
  // A failed write doesn't hold the next one
  writing = run.catch(() => {});
  return run;
}

/**
 * Takes the active profile now, for a read-modify-write. The check it returns
 * gives an error result once another profile is active: call it right before
 * the invoke, with no await between them, so the write can't land in another
 * profile than the one read.
 */
export function guardProfile({ storeManagerService }: AppHandlerVariables) {
  const file = storeManagerService.getSettings().activeProfile.file;
  return (): CallToolResult | undefined =>
    storeManagerService.getSettings().activeProfile.file === file
      ? undefined
      : fail(
          "The active profile changed while this ran. Nothing was saved: read it again and retry.",
        );
}

/**
 * The active profile, or null when it can't be read. Fresh: the store sets
 * its copy only after a write ends, so a save the flush just sent shows here.
 */
export const activeProfile = ({ storeManagerService }: AppHandlerVariables) =>
  storeManagerService.getProfileData({ fresh: true });

/** The active profile, as activeProfile; throws when it can't be read. */
export async function profileOf(handler: AppHandlerVariables) {
  const profile = await activeProfile(handler);
  if (!profile) throw new Error("The active profile couldn't be read.");
  return profile;
}

/** Sends the window the active profile, as GET_PROFILE answers. Pages resync on it. */
export async function pushProfile({
  storeManagerService,
  win,
}: AppHandlerVariables) {
  const profile = await storeManagerService.getProfileData({ fresh: true });
  if (!profile || win.isDestroyed()) return;
  win.webContents.send(
    APP_EVENTS_RESPONSE.GET_PROFILE,
    profileReply(storeManagerService, profile),
  );
}

/** Sends the window the settings and profiles, as GET_SETTINGS answers. */
export function pushSettings({
  storeManagerService,
  win,
}: AppHandlerVariables) {
  if (win.isDestroyed()) return;
  replySettings(
    { reply: (channel, data) => win.webContents.send(channel, data) },
    storeManagerService,
  );
}

// The object a schema describes under its optional, default and the like
const unwrap = (schema: z.core.$ZodType): z.core.$ZodType => {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodCatch
  ) {
    return unwrap(schema.unwrap());
  }
  // z.preprocess: the schema after the function
  if (schema instanceof z.ZodPipe) return unwrap(schema.out);
  return schema;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The dotted paths in `changes` that `schema` has no field for. Zod drops
 * them without a word, so a typo would report success: refuse them, a
 * record's key outside its enum too. Arrays are checked by the schema itself.
 */
export function unknownKeys(
  schema: z.core.$ZodType,
  changes: unknown,
  prefix = "",
): string[] {
  const inner = unwrap(schema);
  if (!isRecord(changes)) return [];
  if (inner instanceof z.ZodUnion) {
    // The option that knows the most of them
    const each = inner.options.map((option) =>
      unknownKeys(option, changes, prefix),
    );
    return each.length === 0
      ? []
      : each.reduce((a, b) => (b.length < a.length ? b : a));
  }
  if (inner instanceof z.ZodRecord) {
    // An enum's record drops the other keys before it's checked (a platform
    // this Tokio doesn't know), so a typo would be dropped too
    const keys = inner.keyType instanceof z.ZodEnum ? inner.keyType : null;
    return Object.entries(changes).flatMap(([key, value]) =>
      keys && !keys.options.includes(key)
        ? [`${prefix}${key}`]
        : unknownKeys(inner.valueType, value, `${prefix}${key}.`),
    );
  }
  if (!(inner instanceof z.ZodObject)) return [];
  // .loose() and .catchall() take any key
  const { catchall } = inner._zod.def;
  const any = catchall !== undefined && !(catchall instanceof z.ZodNever);
  return Object.entries(changes).flatMap(([key, value]) => {
    const field = Object.hasOwn(inner.shape, key) ? inner.shape[key] : null;
    if (!field) return any ? [] : [`${prefix}${key}`];
    return unknownKeys(field, value, `${prefix}${key}.`);
  });
}

/** An error result naming the unknown keys, undefined when there are none. */
export function refuseUnknown(
  schema: z.core.$ZodType,
  changes: unknown,
): CallToolResult | undefined {
  const keys = unknownKeys(schema, changes);
  if (keys.length === 0) return undefined;
  return fail(
    `Unknown settings: ${keys.join(", ")}. Nothing was saved: see describe for the fields.`,
  );
}

/** An error result listing what the schema refused. */
export const invalid = (error: z.ZodError): CallToolResult =>
  fail(`Invalid values, nothing was saved:\n${z.prettifyError(error)}`);

/**
 * An error result unless `path` is a file on this computer. UNC and device
 * paths (\\server, //server, \\?\) are refused before anything touches them:
 * opening one sends the Windows login's NTLM hash to that machine.
 */
export async function checkPath(
  path: string,
): Promise<CallToolResult | undefined> {
  if (/^[\\/]{2}/.test(path)) {
    return fail("Network and device paths aren't allowed. Use a local file.");
  }
  if (!isAbsolute(path)) return fail("The path must be absolute.");
  try {
    if ((await stat(path)).isFile()) return undefined;
    return fail(`${path} isn't a file.`);
  } catch {
    return fail(`${path} doesn't exist or can't be read.`);
  }
}

type Invoked<T> =
  { error: CallToolResult; data?: undefined } | { error?: undefined; data: T };

/**
 * Runs a request's handler through invoke, as if the window had sent it, and
 * gives its `reply`, or an error result with the handler's message: invoke's
 * error for a handler that throws (some only notify), or the reply's when it
 * says `success: false`. Without `reply` only the error is checked.
 */
export async function invokeOk<
  K extends APP_EVENTS,
  R extends APP_EVENTS_RESPONSE,
>(
  handler: AppHandlerVariables,
  event: K,
  data: AppEventsMap[K],
  reply: R,
): Promise<Invoked<AppEventsResponseMap[R]>>;
export async function invokeOk<K extends APP_EVENTS>(
  handler: AppHandlerVariables,
  event: K,
  data: AppEventsMap[K],
): Promise<Invoked<undefined>>;
export async function invokeOk<
  K extends APP_EVENTS,
  R extends APP_EVENTS_RESPONSE,
>(
  handler: AppHandlerVariables,
  event: K,
  data: AppEventsMap[K],
  reply?: R,
): Promise<Invoked<AppEventsResponseMap[R] | undefined>> {
  // Called before any await, so a guardProfile check just before still holds
  const { error, replies } = await handler.invoke(event, data);
  if (error) return { error: fail(error.message) };
  if (reply === undefined) return { data: undefined };
  const found = replies.findLast(([channel]) => channel === reply);
  if (!found) return { error: fail(`Tokio didn't answer ${event}.`) };
  const res: unknown = found[1];
  if (isRecord(res) && res.success === false) {
    const message = isRecord(res.error) ? res.error.message : undefined;
    return {
      error: fail(typeof message === "string" ? message : `${event} failed.`),
    };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the channel ties it to R
  return { data: res as AppEventsResponseMap[R] };
}
