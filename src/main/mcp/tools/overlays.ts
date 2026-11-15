import {
  ALERT_TRIGGERS,
  localizeOverlayConfig,
  OverlayConfigSchema,
  StudioElementSchema,
  StudioGroupSchema,
  StudioOverlaySchema,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, AppEventsMap } from "@/common/types";
import {
  catalogState,
  countedVariables,
  getOverlayURL,
  getStudioOverlayURL,
  STUDIO_NUMBERS,
} from "@/common/util";
import { language, t } from "@/helper/i18n";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
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

// unknownKeys stops at arrays, and a studio overlay is mostly its items: a
// typo in an element would be dropped and reported as saved
function unknownItemKeys(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown, i) => {
    if (!isRecord(item) || item.kind !== "group") {
      return unknownKeys(StudioElementSchema, item, `items.${i}.`);
    }
    const elements: unknown[] = Array.isArray(item.elements)
      ? item.elements
      : [];
    return [
      ...unknownKeys(StudioGroupSchema, item, `items.${i}.`),
      ...elements.flatMap((element, j) =>
        unknownKeys(StudioElementSchema, element, `items.${i}.elements.${j}.`),
      ),
    ];
  });
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
      const payloads = overlayService.getTestPayloads(id);
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
      "The official overlays' catalog, read from GitHub. state: install (not installed), installed (up to date), update, or breaking (a new first version number: ask the streamer before install_overlay with confirmBreaking).",
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
      "Element kinds: text, media (file: a basename from list media), camera, gift (gift id or null for the one sent), emote, shape, viewer (the viewer who set it off), overlay (source: an installed overlay's id, an alert's id, the timer or the games overlay).",
      "when: always (on screen), event (hidden until its trigger, then shows for seconds with its entrance and exit), animate (on screen, plays its animation on each trigger) or loop (on screen, plays idle forever). A group reacts as one, its elements keep their own when. On Like it reacts every likes_every likes from all viewers.",
      `Texts can say ${STUDIO_NUMBERS.map((n) => `{${n}}`).join(" ")} (the LIVE's numbers) and, while they react, their trigger's variables: ${TRIGGER_VARIABLES}. Trigger values and fields are the alert kind's (describe alert).`,
      "test plays every reacting element and group once on stream, with samples.",
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
      const unknown = unknownItemKeys(changes.items);
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

export const tools: ToolDef<any>[] = [
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
        { id },
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
