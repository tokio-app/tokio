import { GameStepSchema, TriggerSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, saveFailure } from "@/helper/feedback";
import { AppHandlerVariables } from "@/types";
import { z } from "zod";

// No success notices: the switch shows its state, actions autosave, and the
// page shows a test's results.
const events = createStack("games");

const TestSchema = z.object({
  id: z.string(),
  trigger: TriggerSchema.shape.type,
  steps: z.array(GameStepSchema),
});

// What main holds, also pushed on every status change (registerGames)
const gamesData = ({
  storeManagerService,
  gamesService,
}: AppHandlerVariables) => ({
  settings: storeManagerService.getSettings().games,
  status: gamesService.status(),
});

events.push(
  APP_EVENTS.GET_GAMES,
  async (services, e) => {
    e.reply(APP_EVENTS_RESPONSE.GAMES, {
      success: true,
      data: gamesData(services),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
      message: "Unable to load the games.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GAMES),
  },
);

// A port that can't be listened on shows in the status, with no notice.
events.push(
  APP_EVENTS.SET_GAMES_SETTINGS,
  async (services, e, { settings }) => {
    const { storeManagerService, gamesService } = services;
    const saved = await storeManagerService.updateGamesSettings(settings);
    await gamesService.configure(storeManagerService.getSettings().games);
    e.reply(APP_EVENTS_RESPONSE.GAMES, {
      success: true,
      data: gamesData(services),
    });
    // The page ignores the failure reply, so it keeps what was sent above.
    if (!saved) throw saveFailure();
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "Unable to change the Minecraft connection.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GAMES),
  },
);

events.push(
  APP_EVENTS.UPDATE_GAMES_SETTINGS,
  async ({ storeManagerService }, e, { settings }) => {
    const res = await storeManagerService.updateProfileData({
      games: settings,
    });
    if (!res) throw new LoggedError("The game actions were not saved.");
    e.reply(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS, { success: true });
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
      message: "Unable to save the game actions.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS),
  },
);

// The page shows the failure next to the action.
events.push(
  APP_EVENTS.TEST_GAME_ACTION,
  async ({ gamesService }, e, data) => {
    const { id, trigger, steps } = TestSchema.parse(data);
    const res = await gamesService.test({ trigger, steps });
    if (!res.success) {
      throw new AppFailure(
        FEEDBACK_CODES.GAME_TEST_FAILED,
        res.error ?? "Unable to test the action.",
        { level: "warning" },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, {
      success: true,
      id,
      results: res.data ?? [],
    });
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.GAME_TEST_FAILED,
      message: "Unable to test the action.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, {
        success: false,
        id,
        results: [],
        error,
      }),
  },
);

export default events;
