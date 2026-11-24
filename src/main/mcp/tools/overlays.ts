import {
  ALERT_TRIGGERS,
  GOAL_TRIGGER,
  localizeOverlayConfig,
  OverlayConfigSchema,
  type StudioElement,
  StudioElementSchema,
  StudioGroupSchema,
  type StudioItem,
  type StudioOverlay,
  StudioOverlaySchema,
  StudioTriggerSchema,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, AppEventsMap } from "@/common/types";
import {
  ALERT_MESSAGE_VARIABLES,
  catalogState,
  countedVariables,
  getOverlayURL,
  getStudioOverlayURL,
  newStudioElement,
  newStudioGroup,
  STUDIO_NUMBERS,
} from "@/common/util";
import { language, t } from "@/helper/i18n";
import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  activeProfile,
  type CallToolResult,
  deepMerge,
  fail,
  invalid,
  invokeOk,
  ok,
  unknownKeys,
} from "../common";
import {
  defineKind,
  defineTool,
  type Handler,
  type Kinds,
  type Sections,
  type ToolDef,
  WRITE,
} from "../defs";

export const sections: Sections = {};

const matches = (query: string | undefined, ...texts: string[]) => {
  const wanted = query?.toLowerCase();
  return !wanted || texts.some((text) => text.toLowerCase().includes(wanted));
};

const needsId = (kind: string) => fail(`Testing a ${kind} needs its id.`);

// An installed overlay the store holds: the handlers refuse other ids with an
// error notice, which a typo from the model shouldn't show the streamer
const isStored = ({ storeManagerService }: Handler, id: string) =>
  storeManagerService.getSettings().overlays.some((o) => o.id === id);

const findStudio = ({ storeManagerService }: Handler, id: string) =>
  storeManagerService.getStudio().find((o) => o.id === id);

const findTestOverlay = ({ overlayService }: Handler, id: string) =>
  overlayService.getTestOverlays().find((o) => o.id === id);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The schema of an element's own kind: the union's check passes a key only
// another kind has, which the save then drops
const elementSchema = (kind: unknown) =>
  StudioElementSchema.options.find((o) => o.shape.kind.value === kind);

// unknownKeys stops at arrays, so each of an item's also_triggers is
// checked here
const unknownTriggerKeys = (item: unknown, prefix: string): string[] =>
  isRecord(item) && Array.isArray(item.also_triggers)
    ? item.also_triggers.flatMap((trigger: unknown, i) =>
        unknownKeys(
          StudioTriggerSchema,
          trigger,
          `${prefix}also_triggers.${i}.`,
        ),
      )
    : [];

const unknownElementKeys = (element: unknown, prefix: string) => [
  ...unknownKeys(
    elementSchema(isRecord(element) ? element.kind : undefined) ??
      StudioElementSchema,
    element,
    prefix,
  ),
  ...unknownTriggerKeys(element, prefix),
];

const unknownGroupKeys = (group: unknown, prefix: string) => [
  ...unknownKeys(StudioGroupSchema, group, prefix),
  ...unknownTriggerKeys(group, prefix),
];

// unknownKeys stops at arrays, and a studio overlay is mostly its items: a
// typo in an element would be dropped and reported as saved
function unknownItemKeysOf(item: unknown, prefix: string): string[] {
  if (!isRecord(item) || item.kind !== "group") {
    return unknownElementKeys(item, prefix);
  }
  const elements: unknown[] = Array.isArray(item.elements) ? item.elements : [];
  return [
    ...unknownGroupKeys(item, prefix),
    ...elements.flatMap((element, j) =>
      unknownElementKeys(element, `${prefix}elements.${j}.`),
    ),
  ];
}

const unknownItemKeys = (items: unknown): string[] =>
  Array.isArray(items)
    ? items.flatMap((item: unknown, i) =>
        unknownItemKeysOf(item, `items.${i}.`),
      )
    : [];

const CounterSchema = StudioOverlaySchema.shape.counters.unwrap().element;

const unknownCounterKeys = (counters: unknown): string[] =>
  Array.isArray(counters)
    ? counters.flatMap((counter: unknown, i) =>
        unknownKeys(CounterSchema, counter, `counters.${i}.`),
      )
    : [];

// The names a text already fills: a counter named so would never show
const TAKEN_NAMES = new Set<string>([
  ...STUDIO_NUMBERS,
  ...Object.values(ALERT_MESSAGE_VARIABLES).flat(),
]);

// The schema takes any counter name, since the editor saves one while it's
// typed and warns about it. Here no one sees a warning.
function counterProblem(counters: StudioOverlay["counters"]) {
  const seen = new Set<string>();
  for (const [i, { name }] of counters.entries()) {
    if (name === "") return `counters.${i} needs a name.`;
    if (TAKEN_NAMES.has(name)) {
      return `counters.${i}: {${name}} is a LIVE number or an event's variable, pick another name.`;
    }
    if (seen.has(name)) return `counters.${i}: another counter is ${name}.`;
    seen.add(name);
  }
  return undefined;
}

// The first "Overlay N" no studio overlay is named, as the Studio page picks
function newStudioName({ storeManagerService }: Handler) {
  const taken = new Set(
    storeManagerService.getStudio().map((o) => o.name.trim()),
  );
  let number = 1;
  while (taken.has(t("studio.newName", { number }))) number++;
  return t("studio.newName", { number });
}

// Studio's handlers reply STUDIO to the window, failures included: only
// invoke's error matters here
const studioInvoke = async <
  K extends
    | APP_EVENTS.ADD_STUDIO_OVERLAY
    | APP_EVENTS.SAVE_STUDIO_OVERLAY
    | APP_EVENTS.REMOVE_STUDIO_OVERLAY
    | APP_EVENTS.TEST_STUDIO_OVERLAY,
>(
  handler: Handler,
  event: K,
  data: AppEventsMap[K],
): Promise<CallToolResult | undefined> =>
  (await invokeOk(handler, event, data)).error;

const TRIGGER_VARIABLES = ALERT_TRIGGERS.map((trigger) => {
  const names = countedVariables(trigger).map((n) => `{${n}}`);
  return `${trigger}: ${names.join(" ") || "none"}`;
}).join("; ");

const StudioChanges = StudioOverlaySchema.omit({ id: true });

const TestOverlayChanges = z.object({ name: z.string().min(1) }).strict();

export const kinds: Kinds = {
  overlays: defineKind({
    notes:
      "Installed overlays, official (from the catalog) or imported. Each is one browser source at its url. Their settings are the overlay_settings kind and save_overlay_settings. Importing a folder is only in the app.",
    list: ({ overlayService }, { query, limit }) => {
      const found = overlayService
        .getOverlays()
        .filter((o) => matches(query, o.id, o.name));
      return ok({
        total: found.length,
        overlays: found.slice(0, limit).map((o) => ({
          id: o.id,
          name: o.name,
          version: o.version,
          official: !o.external,
          hasSettings: o.config,
          url: getOverlayURL(o.id),
        })),
      });
    },
    remove: async (handler, id) => {
      if (!isStored(handler, id)) return fail(`No overlay ${id} is installed.`);
      const { error } = await invokeOk(handler, APP_EVENTS.REMOVE_OVERLAY, {
        id,
      });
      return error ?? ok("Removed.");
    },
    test: async (handler, id) => {
      if (id === undefined) return needsId("overlay");
      const { overlayService, serverService } = handler;
      // Every id would keep a test LIVE in memory until Tokio quits
      if (!overlayService.getOverlays().some((o) => o.id === id)) {
        return fail(`No overlay ${id} is served.`);
      }
      // TEST_OVERLAY's reply only makes an open Overlays page send them
      const profile = await activeProfile(handler);
      const payloads = overlayService.getTestPayloads(
        id,
        profile?.platforms ?? ["tiktok"],
      );
      const sent = payloads.every((p) => serverService.sendToClient(id, p));
      return ok({
        events: payloads.length,
        // false: no browser source has the overlay open
        reachedStream: sent,
      });
    },
  }),

  overlay_settings: defineKind({
    notes:
      "An installed overlay's settings, by the overlay's id: its sections and fields, each with its id, type, value and default (and options, min and max, or a table's columns). Change them with save_overlay_settings, by field id.",
    get: async ({ overlayService }, id) => {
      const res = await overlayService.getConfig(id);
      if (!res.success) {
        return fail(
          `No overlay ${id} is installed, or its settings can't be read.`,
        );
      }
      if (!res.data) return ok({ id, settings: null });
      return ok({ id, settings: localizeOverlayConfig(res.data, language()) });
    },
  }),

  official_overlays: defineKind({
    notes:
      "The official overlays' catalog, read from GitHub. state: install (not installed), installed (up to date), update, or breaking (a new first version number: ask the streamer before install_overlay with confirmBreaking). platforms: where it works (null: every platform). This lists every entry; the app's Official overlays page shows only the ones for the profile's platforms, and the installed ones.",
    list: async ({ overlayService }, { query, limit }) => {
      const res = await overlayService.getCatalog();
      if (!res.success) {
        return fail(
          "Tokio couldn't read the overlay catalog. It may be offline.",
        );
      }
      const installed = overlayService.getOverlays();
      const found = res.data!.filter((e) =>
        matches(query, e.id, e.name, e.description),
      );
      return ok({
        total: found.length,
        overlays: found.slice(0, limit).map((e) => ({
          id: e.id,
          name: e.name,
          version: e.version,
          description: e.description,
          hasSettings: e.config,
          platforms: e.platforms ?? null,
          state: catalogState(e, installed),
          installedVersion:
            installed.find((o) => o.id === e.id && !o.external)?.version ??
            null,
        })),
      });
    },
  }),

  studio_overlay: defineKind({
    schema: StudioChanges,
    notes: [
      "Overlay Studio's overlays, shared by every profile. Each is one browser source at its url, a canvas of 1080x1920 px (portrait) or 1920x1080 (landscape); x, y, width and height are px of it from the top left.",
      "items go back to front (the first is the back): groups (kind group, with elements back to front) and elements on their own. Groups don't hold groups. Every id in the overlay, groups' and elements' both, must be unique: pick short new ones. save_item replaces items whole, so send the full list.",
      "Element kinds: text, media (file: a basename from list media), camera, gift (gift id or null for the one sent), emote, shape, viewer (the viewer who set it off), bar (a goal bar: fills as number, a LIVE number but uptime or a counter's name, comes to goal), list (rows of its source: this LIVE's top gifters on its platform, tiktok by default, twitch, youtube or kick, ranked in that platform's currency (coins, Bits, US dollars or Kicks), or its newest followers, gifts or chat), overlay (source: an installed overlay's id, an alert's id, the timer or the games overlay).",
      "Every element can have a shadow (shadow_x and shadow_y 0 make a glow) and a blur. Texts take an outline, letter_spacing and line_height (% of size), italic and caps; texts and shapes a gradient from color into gradient_color at gradient_angle (CSS degrees: 90 runs left to right).",
      "when: always (on screen), event (hidden until its trigger, then shows for seconds with its entrance and exit), animate (on screen, plays its animation on each trigger) or loop (on screen, plays idle forever). A group reacts as one, its elements keep their own when. On Like it reacts every likes_every likes from all viewers.",
      `It also reacts to each of also_triggers (up to 4 more), and waits delay seconds (0 to 10) before it plays. A trigger of type ${GOAL_TRIGGER} reacts once per LIVE when number (a LIVE number but uptime, or a counter's name) reaches goal. counters (up to 10) count a trigger during the LIVE, a gift by its gifts and a Like by its likes, and texts show each as {name}: a name of word characters, not empty, taken or a LIVE number's.`,
      `Texts can say ${STUDIO_NUMBERS.map((n) => `{${n}}`).join(" ")} (the LIVE's numbers; each currency is its platform's, never added up: {coins} TikTok's coins, {kicks} Kick's Kicks, {bits} Twitch's Bits, {superchats} YouTube's Super Chats in US dollars, a dash until the exchange rates load; {giftsubs} counts the subs gifted on Twitch, YouTube and Kick) and, while they react, their trigger's variables: ${TRIGGER_VARIABLES}. Trigger values and fields are the alert kind's (describe alert), min_coins's units included.`,
      "test plays every reacting element and group once on stream, with samples.",
      "To change single items, use edit_studio_overlay instead of resending items.",
      "preview_studio_overlay returns a picture of the overlay.",
      "To duplicate one: get it, then save_item without id, sending its fields minus id and url.",
    ].join("\n"),
    list: ({ storeManagerService }, { query, limit }) => {
      const found = storeManagerService
        .getStudio()
        .filter((o) => matches(query, o.name));
      return ok({
        total: found.length,
        overlays: found.slice(0, limit).map((o) => ({
          id: o.id,
          name: o.name,
          size: o.size,
          items: o.items.length,
          url: getStudioOverlayURL(o.id),
        })),
      });
    },
    get: (handler, id) => {
      const overlay = findStudio(handler, id);
      if (!overlay) return fail(`No studio overlay ${id}.`);
      return ok({ ...overlay, url: getStudioOverlayURL(id) });
    },
    save: async (handler, id, changes) => {
      const unknown = [
        ...unknownItemKeys(changes.items),
        ...unknownCounterKeys(changes.counters),
      ];
      if (unknown.length > 0) {
        return fail(
          `Unknown settings: ${unknown.join(", ")}. Nothing was saved: see describe for the fields.`,
        );
      }
      const stored =
        id === undefined
          ? { id: randomUUID(), name: newStudioName(handler) }
          : findStudio(handler, id);
      if (!stored) return fail(`No studio overlay ${id}.`);
      // Checked before the add, so a bad overlay doesn't leave an empty one
      const parsed = StudioOverlaySchema.safeParse(deepMerge(stored, changes));
      if (!parsed.success) return invalid(parsed.error);
      const overlay = parsed.data;
      // Only the ones sent: the editor's may be mid-typing
      const problem =
        changes.counters === undefined
          ? undefined
          : counterProblem(overlay.counters);
      if (problem) return fail(`${problem} Nothing was saved.`);

      if (id === undefined) {
        const error = await studioInvoke(
          handler,
          APP_EVENTS.ADD_STUDIO_OVERLAY,
          { id: overlay.id, name: overlay.name },
        );
        if (error) return error;
      }
      const error = await studioInvoke(
        handler,
        APP_EVENTS.SAVE_STUDIO_OVERLAY,
        { overlay },
      );
      return (
        error ??
        ok({
          id: overlay.id,
          name: overlay.name,
          url: getStudioOverlayURL(overlay.id),
        })
      );
    },
    remove: async (handler, id) => {
      if (!findStudio(handler, id)) return fail(`No studio overlay ${id}.`);
      return (
        (await studioInvoke(handler, APP_EVENTS.REMOVE_STUDIO_OVERLAY, {
          id,
        })) ?? ok("Removed.")
      );
    },
    test: async (handler, id) => {
      if (id === undefined) return needsId("studio overlay");
      if (!findStudio(handler, id)) return fail(`No studio overlay ${id}.`);
      return (
        (await studioInvoke(handler, APP_EVENTS.TEST_STUDIO_OVERLAY, {
          id,
        })) ?? ok("Played on its browser sources.")
      );
    },
  }),

  test_overlay: defineKind({
    schema: TestOverlayChanges,
    notes:
      "Ids for testing an overlay that isn't imported: the overlay connects to Tokio with the id, and test sends it a test LIVE's events. They can be added and removed, not renamed.",
    list: ({ overlayService }, { query, limit }) => {
      const found = overlayService
        .getTestOverlays()
        .filter((o) => matches(query, o.name));
      return ok({
        total: found.length,
        testOverlays: found
          .slice(0, limit)
          .map(({ id, name }) => ({ id, name })),
      });
    },
    save: async (handler, id, changes) => {
      if (id !== undefined) {
        return fail("A test overlay can't be changed, only added or removed.");
      }
      const parsed = TestOverlayChanges.safeParse(changes);
      if (!parsed.success) return invalid(parsed.error);
      const before = new Set(
        handler.overlayService.getTestOverlays().map((o) => o.id),
      );
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.ADD_TEST_OVERLAY,
        parsed.data,
        APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS,
      );
      if (error) return error;
      const added = data.data?.find((o) => !before.has(o.id));
      return ok(added ? { id: added.id, name: added.name } : "Added.");
    },
    remove: async (handler, id) => {
      if (!findTestOverlay(handler, id)) return fail(`No test overlay ${id}.`);
      const { error } = await invokeOk(
        handler,
        APP_EVENTS.REMOVE_TEST_OVERLAY,
        { id },
      );
      return error ?? ok("Removed.");
    },
    test: async (handler, id) => {
      if (id === undefined) return needsId("test overlay");
      // Every id would keep a test LIVE in memory until Tokio quits
      if (!findTestOverlay(handler, id)) return fail(`No test overlay ${id}.`);
      // Its success: false means no overlay is connected, not a failure
      const { error, replies } = await handler.invoke(
        APP_EVENTS.SEND_TEST_EVENTS,
        { id },
      );
      if (error) return fail(error.message);
      const reply: unknown = replies.findLast(
        ([channel]) => channel === APP_EVENTS_RESPONSE.SEND_TEST_EVENTS,
      )?.[1];
      return ok({ reachedOverlay: isRecord(reply) && reply.success === true });
    },
  }),
};

const InstallInput = z
  .object({
    id: z.string().describe("The catalog id, from list official_overlays"),
    confirmBreaking: z
      .boolean()
      .optional()
      .describe(
        "true only after the streamer agreed to a breaking update: its settings may not carry over and the overlay may look or work differently",
      ),
  })
  .strict();

const SaveSettingsInput = z
  .object({
    id: z.string().describe("The overlay's id"),
    values: z
      .record(z.string(), z.unknown())
      .describe("New values by field id, each of the field's type"),
  })
  .strict();

// One shape for every op, not a union: some clients choke on anyOf
const EditOp = z
  .object({
    op: z
      .enum(["add", "change", "remove", "move"])
      .describe(
        "add: a new item (item), placed by group or behind, else in front. change: deep-merges set into item id. remove: item id (a group goes with its elements). move: item id into group and/or right behind behind.",
      ),
    id: z
      .string()
      .min(1)
      .optional()
      .describe("The element or group to change, remove or move"),
    item: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'add: the new element or group. kind is required (an element kind, or "group" with its elements); the rest falls back to the kind\'s defaults, centered. Without id it gets a new one.',
      ),
    set: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("change: the fields to change. Not kind, id or elements."),
    group: z
      .string()
      .nullable()
      .optional()
      .describe(
        "add, move: the group to put it in, at the front of its elements. null (move): on its own, in front. Groups don't go into groups.",
      ),
    behind: z
      .string()
      .optional()
      .describe(
        "add, move: the item to put it right behind, in that item's group if it's in one",
      ),
  })
  .strict();
type EditOp = z.output<typeof EditOp>;

const EditInput = z
  .object({
    id: z.string().describe("The studio overlay's id"),
    ops: z
      .array(EditOp)
      .min(1)
      .max(100)
      .describe("Applied in order. If one fails, nothing is saved."),
  })
  .strict();

const EDIT_FIELDS: Record<EditOp["op"], string[]> = {
  add: ["item", "group", "behind"],
  change: ["id", "set"],
  remove: ["id"],
  move: ["id", "group", "behind"],
};

// An op the model got wrong: ends the edit, nothing saved
class EditError extends Error {}

const parseItem = <T extends z.ZodType>(schema: T, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new EditError(`Invalid values:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

const idsOf = (items: StudioItem[]) =>
  new Set(
    items.flatMap((item) =>
      item.kind === "group"
        ? [item.id, ...item.elements.map((e) => e.id)]
        : [item.id],
    ),
  );

// The given id, or a short new one, unique in the overlay
function takeId(raw: Record<string, unknown>, taken: Set<string>): string {
  if (raw.id !== undefined && typeof raw.id !== "string") {
    throw new EditError("An id must be a string.");
  }
  if (raw.id !== undefined && taken.has(raw.id)) {
    throw new EditError(`The id ${raw.id} is taken.`);
  }
  let id = raw.id;
  while (id === undefined || taken.has(id)) id = randomBytes(4).toString("hex");
  taken.add(id);
  return id;
}

// A new element from its kind's defaults, as the editor adds one
function newElement(
  raw: unknown,
  size: StudioOverlay["size"],
  taken: Set<string>,
): StudioElement {
  const kind = isRecord(raw) ? elementSchema(raw.kind)?.shape.kind.value : "";
  if (!isRecord(raw) || !kind) {
    throw new EditError("An element needs a known kind.");
  }
  const id = takeId(raw, taken);
  return parseItem(
    StudioElementSchema,
    deepMerge(newStudioElement(kind, size), { ...raw, id }),
  );
}

// "Group N", the first number no group's name uses, as the editor picks
function newGroupName(items: StudioItem[]) {
  const taken = new Set(
    items.filter((i) => i.kind === "group").map((g) => g.name.trim()),
  );
  let number = 1;
  while (taken.has(t("studio.editor.groupName", { number }))) number++;
  return t("studio.editor.groupName", { number });
}

function locate(items: StudioItem[], id: string) {
  for (const [index, item] of items.entries()) {
    if (item.id === id) return { item, index, group: null };
    if (item.kind !== "group") continue;
    const at = item.elements.findIndex((e) => e.id === id);
    if (at !== -1) return { item: item.elements[at], index: at, group: item };
  }
  throw new EditError(`No item ${id}.`);
}

// Puts item in front of its list, or right behind `behind` in its list
function place(
  items: StudioItem[],
  item: StudioItem,
  { group, behind }: Pick<EditOp, "group" | "behind">,
) {
  let holder: StudioItem | null = null;
  let index: number | undefined;
  if (behind !== undefined) {
    const at = locate(items, behind);
    if (group !== undefined && group !== (at.group?.id ?? null)) {
      throw new EditError(
        `${behind} is in ${at.group ? `group ${at.group.id}` : "no group"}, not the group given.`,
      );
    }
    holder = at.group;
    index = at.index;
  } else if (group !== undefined && group !== null) {
    holder = items.find((i) => i.kind === "group" && i.id === group) ?? null;
    if (!holder) throw new EditError(`No group ${group}.`);
  }
  if (holder?.kind !== "group") {
    items.splice(index ?? items.length, 0, item);
  } else if (item.kind === "group") {
    throw new EditError("A group can't go into a group.");
  } else {
    holder.elements.splice(index ?? holder.elements.length, 0, item);
  }
}

// Applies one op to items in place; returns the ids it added
function applyEdit(
  items: StudioItem[],
  op: EditOp,
  path: string,
  size: StudioOverlay["size"],
): string[] {
  const extra = Object.entries(op)
    .filter(
      ([key, value]) =>
        key !== "op" &&
        value !== undefined &&
        !EDIT_FIELDS[op.op].includes(key),
    )
    .map(([key]) => key);
  if (extra.length > 0) {
    throw new EditError(`${op.op} doesn't take ${extra.join(", ")}.`);
  }

  if (op.op === "add") {
    const raw = op.item;
    if (!raw) throw new EditError("add needs item.");
    const unknown = unknownItemKeysOf(raw, `${path}.item.`);
    if (unknown.length > 0) {
      throw new EditError(`Unknown settings: ${unknown.join(", ")}.`);
    }
    const taken = idsOf(items);
    let added: StudioItem;
    if (raw.kind === "group") {
      const id = takeId(raw, taken);
      if (raw.elements !== undefined && !Array.isArray(raw.elements)) {
        throw new EditError("A group's elements must be a list.");
      }
      const given: unknown[] = Array.isArray(raw.elements) ? raw.elements : [];
      const elements = given.map((e) => newElement(e, size, taken));
      added = parseItem(
        StudioGroupSchema,
        deepMerge(newStudioGroup(newGroupName(items)), {
          ...raw,
          id,
          elements,
        }),
      );
    } else {
      added = newElement(raw, size, taken);
    }
    place(items, added, op);
    return added.kind === "group"
      ? [added.id, ...added.elements.map((e) => e.id)]
      : [added.id];
  }

  if (op.id === undefined) throw new EditError(`${op.op} needs id.`);
  const found = locate(items, op.id);
  const list = found.group ? found.group.elements : items;

  if (op.op === "change") {
    const { set } = op;
    if (!set) throw new EditError("change needs set.");
    const refused = ["kind", "id", "elements"].filter((k) =>
      Object.hasOwn(set, k),
    );
    if (refused.length > 0) {
      throw new EditError(`set can't change ${refused.join(", ")}.`);
    }
    const { item } = found;
    const unknown =
      item.kind === "group"
        ? unknownGroupKeys(set, `${path}.set.`)
        : unknownElementKeys({ ...set, kind: item.kind }, `${path}.set.`);
    if (unknown.length > 0) {
      throw new EditError(`Unknown settings: ${unknown.join(", ")}.`);
    }
    const merged = deepMerge(item, set);
    if (item.kind === "group") {
      items[found.index] = parseItem(StudioGroupSchema, merged);
    } else {
      list[found.index] = parseItem(StudioElementSchema, merged);
    }
    return [];
  }

  if (op.op === "remove") {
    list.splice(found.index, 1);
    return [];
  }
  if (op.group === undefined && op.behind === undefined) {
    throw new EditError("move needs group or behind.");
  }
  if (op.behind === op.id) {
    throw new EditError("An item can't go behind itself.");
  }
  // Behind one of its own elements, which go with it
  if (
    op.behind !== undefined &&
    locate(items, op.behind).group === found.item
  ) {
    throw new EditError("A group can't go into a group.");
  }
  list.splice(found.index, 1);
  place(items, found.item, op);
  return [];
}

// Every group and element, back to front: what the model needs to go on
const itemList = (items: StudioItem[]) =>
  items.flatMap((item): Record<string, string>[] =>
    item.kind === "group"
      ? [
          { id: item.id, kind: item.kind, name: item.name },
          ...item.elements.map((e) => ({
            id: e.id,
            kind: e.kind,
            label: e.label,
            group: item.id,
          })),
        ]
      : [{ id: item.id, kind: item.kind, label: item.label }],
  );

export const tools: ToolDef<any>[] = [
  defineTool({
    name: "edit_studio_overlay",
    title: "Edit a studio overlay's items",
    description:
      "Adds, changes, removes or moves single elements and groups of a studio overlay, without resending its items. Ops apply in order; if one fails, nothing is saved. Returns the ids added and every item back to front.",
    input: EditInput,
    annotations: WRITE,
    run: async (handler, { id, ops }) => {
      const stored = findStudio(handler, id);
      if (!stored) return fail(`No studio overlay ${id}.`);
      const items = structuredClone(stored.items);
      const added: string[] = [];
      for (const [i, op] of ops.entries()) {
        try {
          added.push(...applyEdit(items, op, `ops.${i}`, stored.size));
        } catch (e) {
          if (!(e instanceof EditError)) throw e;
          const what = op.id === undefined ? op.op : `${op.op} ${op.id}`;
          return fail(`ops.${i} (${what}): ${e.message} Nothing was saved.`);
        }
      }
      const parsed = StudioOverlaySchema.safeParse({ ...stored, items });
      if (!parsed.success) return invalid(parsed.error);
      const error = await studioInvoke(
        handler,
        APP_EVENTS.SAVE_STUDIO_OVERLAY,
        { overlay: parsed.data },
      );
      return error ?? ok({ added, items: itemList(parsed.data.items) });
    },
  }),
  defineTool({
    name: "install_overlay",
    title: "Install an official overlay",
    description:
      "Installs an official overlay from the catalog (list official_overlays), or updates an installed one to the catalog's version, keeping the settings that still fit. A breaking update (state breaking) is refused unless confirmBreaking is true: ask the streamer first. Streaming apps keep the old page until refreshed.",
    input: InstallInput,
    annotations: { ...WRITE, openWorldHint: true },
    run: async (handler, { id, confirmBreaking }) => {
      const { overlayService } = handler;
      const catalog = await overlayService.getCatalog();
      if (!catalog.success) {
        return fail(
          "Tokio couldn't read the overlay catalog. It may be offline.",
        );
      }
      const entry = catalog.data!.find((e) => e.id === id);
      if (!entry) return fail(`The catalog has no overlay ${id}.`);
      const state = catalogState(entry, overlayService.getOverlays());
      const result = { id, version: entry.version, url: getOverlayURL(id) };
      if (state === "installed") return ok({ ...result, state });
      if (state === "breaking" && !confirmBreaking) {
        return fail(
          `Version ${entry.version} of ${entry.name} is a breaking update: its settings may not carry over. Nothing was installed. Ask the streamer, then call again with confirmBreaking: true.`,
        );
      }
      const { error } = await invokeOk(
        handler,
        APP_EVENTS.INSTALL_OVERLAY,
        { id, version: entry.version },
        APP_EVENTS_RESPONSE.INSTALL_OVERLAY,
      );
      return (
        error ??
        ok({ ...result, state: state === "install" ? "installed" : "updated" })
      );
    },
  }),
  defineTool({
    name: "save_overlay_settings",
    title: "Change an overlay's settings",
    description:
      "Changes an installed overlay's settings by field id (get overlay_settings lists the fields). Fields left out keep their values. A value that doesn't fit its field (another type, not among the options, out of range) keeps the old one: `dropped` lists them.",
    input: SaveSettingsInput,
    annotations: { ...WRITE, idempotentHint: true },
    run: async (handler, { id, values }) => {
      const { overlayService } = handler;
      const res = await overlayService.getConfig(id);
      if (!res.success) {
        return fail(
          `No overlay ${id} is installed, or its settings can't be read.`,
        );
      }
      if (!res.data) return fail(`The overlay ${id} has no settings.`);
      const config = structuredClone(res.data);
      const ids = new Set(config.fields.map((f) => f.id));
      const unknown = Object.keys(values).filter((key) => !ids.has(key));
      if (unknown.length > 0) {
        return fail(
          `Unknown fields: ${unknown.join(", ")}. Nothing was saved. The fields are: ${[...ids].join(", ")}.`,
        );
      }
      for (const field of config.fields) {
        if (Object.hasOwn(values, field.id)) {
          Object.assign(field.attributes, { value: values[field.id] });
        }
      }
      // The save refuses what the schema does, with only a generic message
      const parsed = OverlayConfigSchema.safeParse(config);
      if (!parsed.success) return invalid(parsed.error);

      const { error } = await invokeOk(
        handler,
        APP_EVENTS.SAVE_OVERLAY_CONFIG,
        { id, config: parsed.data },
        APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG,
      );
      if (error) return error;
      const saved = await overlayService.getConfig(id);
      const fields = saved.data?.fields ?? [];
      const dropped = Object.keys(values).filter(
        (key) =>
          !isDeepStrictEqual(
            fields.find((f) => f.id === key)?.attributes.value,
            values[key],
          ),
      );
      return ok({
        saved: Object.keys(values).filter((key) => !dropped.includes(key)),
        dropped,
      });
    },
  }),
];
