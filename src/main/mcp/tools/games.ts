import {
  ALERT_TRIGGERS,
  type GameAction,
  GameActionSchema,
  GamesOverlaySchema,
  GameStepSchema,
  type Profile,
} from "@/common/schemas";
import {
  countedVariables,
  createAction,
  gameStepsText,
  getMinecraftOverlayURL,
  JAVA_ONLY_HAZARDS,
  JAVA_ONLY_STEPS,
  MINECRAFT_NAMES,
} from "@/common/util";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { z } from "zod";
import {
  type CallToolResult,
  deepMerge,
  fail,
  guardProfile,
  invalid,
  invokeOk,
  ok,
  profileOf,
  pushProfile,
  PLATFORM_NOTE,
} from "../common";
import {
  defineKind,
  defineSection,
  type Handler,
  type Kinds,
  type Sections,
  type ToolDef,
} from "../defs";

/**
 * Saves the profile's games with `actions`, the stored look kept, through
 * the Games page's handler, then sends the window the profile. The guard
 * comes from before the profile was read.
 */
async function saveActions(
  handler: Handler,
  games: Profile["games"],
  actions: GameAction[],
  changed: () => CallToolResult | undefined,
) {
  const refused = changed();
  if (refused) return { error: refused };
  const { error } = await invokeOk(
    handler,
    APP_EVENTS.UPDATE_GAMES_SETTINGS,
    { settings: { actions, overlay: games.overlay } },
    APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS,
  );
  // Also after a failed save: the window shows what main holds
  await pushProfile(handler);
  return { error };
}

// What would run nothing: an id the edition's lists don't have, or one of the
// Tokio mod's steps on Bedrock
function stepProblem({ edition, steps }: GameAction): string | undefined {
  const { mobs, items } = MINECRAFT_NAMES[edition];
  for (const step of steps) {
    if (
      (step.type === "spawn" || step.type === "morph") &&
      !Object.hasOwn(mobs, step.mob)
    ) {
      return `${step.mob} isn't a ${edition} mob id.`;
    }
    if (step.type === "give" && !Object.hasOwn(items, step.item)) {
      return `${step.item} isn't a ${edition} item id.`;
    }
    if (edition !== "bedrock") continue;
    if (
      JAVA_ONLY_STEPS.includes(step.type) ||
      (step.type === "hazard" && Object.hasOwn(JAVA_ONLY_HAZARDS, step.hazard))
    ) {
      return `The ${step.type === "hazard" ? step.hazard : step.type} step needs the Tokio mod: Java Edition only.`;
    }
  }
  return undefined;
}

const findAction = (games: Profile["games"], id: string) =>
  games.actions.find((a) => a.id === id);

const noAction = (id: string) =>
  fail(`There's no game action ${id}: list game_action gives the ids.`);

// The trigger's variables a step's text (a command, a mob's name) can hold
const VARIABLES = ALERT_TRIGGERS.map((trigger) => {
  const names = countedVariables(trigger);
  return `${trigger}: ${names.length ? names.map((v) => `{${v}}`).join(" ") : "none"}`;
}).join("; ");

export const sections: Sections = {
  games_overlay: defineSection({
    schema: GamesOverlaySchema.strict(),
    read: async (handler) =>
      GamesOverlaySchema.parse((await profileOf(handler)).games.overlay),
    write: async (handler, values) => {
      // The guard update_settings checked holds until the read's await
      const changed = guardProfile(handler);
      const games = (await profileOf(handler)).games;
      const { error } = await saveActions(
        handler,
        { ...games, overlay: values },
        games.actions,
        changed,
      );
      return error ?? ok("Saved.");
    },
    info: async (handler) => {
      const { columns } = (await profileOf(handler)).games.overlay;
      return {
        overlayURL: getMinecraftOverlayURL(),
        // A browser source per column, when there are several
        columnURLs:
          columns > 1
            ? Array.from({ length: columns }, (_, i) =>
                getMinecraftOverlayURL(i + 1),
              )
            : [],
      };
    },
    notes:
      "How the games overlay looks, for the active profile. Each game action is a row: the event's pictures or text, an arrow, then the action's picture and name (each action's own `overlay` field sets those). layout list stacks the rows, horizontal puts them side by side, carousel shows one at a time. format sticker puts the event's picture on the corner of the action's. columns splits the rows into that many overlays, each at its own URL (columnURLs); an action's overlay.column picks one. Colors are #rrggbb or #rrggbbaa. font is a font installed on the PC that runs the streaming app, empty for Tokio's.",
  }),
  minecraft: defineSection({
    schema: z
      .object({
        minecraft: z.object({ enabled: z.boolean() }).strict(),
      })
      .strict(),
    read: ({ storeManagerService }) => ({
      minecraft: {
        enabled: storeManagerService.getSettings().games.minecraft.enabled,
      },
    }),
    write: async (handler, values) => {
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.SET_GAMES_SETTINGS,
        { settings: { minecraft: { enabled: values.minecraft.enabled } } },
        APP_EVENTS_RESPONSE.GAMES,
      );
      const status = data?.data?.status.minecraft;
      return (
        error ??
        ok({
          status: status && {
            state: status.state,
            edition: status.edition,
            error: status.error,
          },
        })
      );
    },
    info: ({ gamesService }) => {
      const { state, edition, error } = gamesService.status().minecraft;
      return { status: { state, edition, error } };
    },
    notes:
      "minecraft.enabled makes Tokio listen for Minecraft on port 37892, the same for every profile. Then the player joins from the game's chat: Bedrock with /connect localhost:37892 in a world with cheats on (after Settings → General → Network settings → Enable WebSockets); Java Edition with /tokio connect, from the Tokio mod. status.state is off, waiting (no game yet), connected (with its edition) or error.",
  }),
};

export const kinds: Kinds = {
  game_action: defineKind({
    // The saved action without its id. Steps as they're saved (the stored
    // schema migrates old ones first, which describe can't show).
    schema: GameActionSchema.omit({ id: true })
      .extend({ steps: z.array(GameStepSchema) })
      .strict(),
    notes: [
      "What a LIVE event does in Minecraft, in the active profile: when its trigger fires, its steps run in order, in a game of its edition (bedrock or java) that's connected. trigger works as an alert's: type is the event, gifts are gift ids (list gifts) with every_gift to run once per gift instead of once per streak, emotes are emote ids (list emotes), keyword is the chat's. On like, the action runs once every likes_every likes from all viewers.",
      PLATFORM_NOTE,
      "Mob and item ids are the game's own, like zombie or diamond_sword (chicken_jockey is Tokio's), and differ between the editions; an unknown one is refused. morph, unmorph and the meteor and laser hazards are the Tokio mod's, Java only. amount is how many (1 to the step's max). A command step is typed as in the game's chat and runs as the player.",
      `Text in a command, a spawned mob's name and the overlay's texts can hold the trigger's variables: ${VARIABLES}.`,
      "overlay sets its row on the games overlay: show, image (a {name, file} from list minecraft_pictures, or null), event and name (empty for automatic texts) and column. steps replace whole when changed. Ask before adding hazards that can kill the player or wreck their world (tnt, lava_lake, hole, random_boss, clear_inventory).",
    ].join("\n"),
    list: async (handler, { query, limit }) => {
      const wanted = query?.toLowerCase();
      const found = (await profileOf(handler)).games.actions
        .map((a) => ({
          id: a.id,
          enabled: a.enabled,
          edition: a.edition,
          trigger: a.trigger.type,
          does: gameStepsText(a, "en") || a.steps.map((s) => s.type).join(", "),
          shown: a.overlay.show,
        }))
        .filter(
          (a) =>
            !wanted || `${a.trigger} ${a.does}`.toLowerCase().includes(wanted),
        );
      return ok({ total: found.length, actions: found.slice(0, limit) });
    },
    get: async (handler, id) => {
      const action = findAction((await profileOf(handler)).games, id);
      if (!action) return noAction(id);
      return ok({
        action: GameActionSchema.parse(action),
        overlayURL: getMinecraftOverlayURL(),
      });
    },
    save: async (handler, id, changes) => {
      const changed = guardProfile(handler);
      const { games } = await profileOf(handler);
      const stored = id === undefined ? undefined : findAction(games, id);
      if (id !== undefined && !stored) return noAction(id);
      const edition = GameActionSchema.shape.edition.safeParse(changes.edition);
      const base =
        stored ?? createAction(edition.success ? edition.data : "bedrock");
      const parsed = GameActionSchema.safeParse(
        deepMerge(base, { ...changes, id: base.id }),
      );
      if (!parsed.success) return invalid(parsed.error);
      const action = parsed.data;
      const problem = stepProblem(action);
      if (problem) return fail(`${problem} Nothing was saved.`);
      const { image } = action.overlay;
      if (
        image &&
        !handler.storeManagerService
          .getMinecraftPictures()
          .some((p) => p.file === image.file)
      ) {
        return fail(
          `${image.file} isn't in the Minecraft pictures: list minecraft_pictures gives them. Nothing was saved.`,
        );
      }
      const actions = stored
        ? games.actions.map((a) => (a.id === action.id ? action : a))
        : [...games.actions, action];
      const { error } = await saveActions(handler, games, actions, changed);
      return (
        error ?? ok({ id: action.id, overlayURL: getMinecraftOverlayURL() })
      );
    },
    remove: async (handler, id) => {
      const changed = guardProfile(handler);
      const { games } = await profileOf(handler);
      if (!findAction(games, id)) return noAction(id);
      const { error } = await saveActions(
        handler,
        games,
        games.actions.filter((a) => a.id !== id),
        changed,
      );
      return error ?? ok("Removed.");
    },
    // Runs what's saved, as the Games page's Test does with what it shows
    test: async (handler, id) => {
      if (id === undefined) return fail("Give the game action's id.");
      const action = findAction((await profileOf(handler)).games, id);
      if (!action) return noAction(id);
      const { error, data } = await invokeOk(
        handler,
        APP_EVENTS.TEST_GAME_ACTION,
        {
          id,
          edition: action.edition,
          trigger: action.trigger.type,
          steps: action.steps,
        },
        APP_EVENTS_RESPONSE.TEST_GAME_ACTION,
      );
      if (error) return error;
      // The game's replies, in its language
      return ok({
        results: data.results.map(({ command, ok, message }) => ({
          command,
          ok,
          gameReply: message,
        })),
      });
    },
  }),
  games_overlay_row: defineKind({
    notes:
      "test lights a game action's row on the games overlay as a run does, without running anything in the game. The id is the action's.",
    test: async (handler, id) => {
      if (id === undefined) return fail("Give the game action's id.");
      if (!findAction((await profileOf(handler)).games, id)) {
        return noAction(id);
      }
      const { error } = await invokeOk(handler, APP_EVENTS.TEST_GAMES_OVERLAY, {
        id,
      });
      return error ?? ok("Lit up.");
    },
  }),
  minecraft_pictures: defineKind({
    notes:
      "The pictures game actions show on the games overlay, shared by every profile. The id is the file. add_to_library adds one. Removing one takes it off every action in every profile, then deletes the file.",
    list: ({ storeManagerService }, { query, limit }) => {
      const wanted = query?.toLowerCase();
      const found = storeManagerService
        .getMinecraftPictures()
        .filter((p) => !wanted || p.name.toLowerCase().includes(wanted))
        .reverse();
      return ok({
        total: found.length,
        pictures: found
          .slice(0, limit)
          .map(({ name, file }) => ({ id: file, name, file })),
      });
    },
    remove: async (handler, id) => {
      const known = handler.storeManagerService
        .getMinecraftPictures()
        .some((p) => p.file === id);
      if (!known) {
        return fail(
          `There's no Minecraft picture ${id}: list minecraft_pictures gives them.`,
        );
      }
      const { error } = await invokeOk(
        handler,
        APP_EVENTS.REMOVE_MINECRAFT_PICTURE,
        { file: id },
        APP_EVENTS_RESPONSE.MINECRAFT_PICTURES,
      );
      return error ?? ok("Removed.");
    },
  }),
};

export const tools: ToolDef<any>[] = [];
