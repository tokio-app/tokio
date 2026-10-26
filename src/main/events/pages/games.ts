import {
  GameActionSchema,
  GameStepSchema,
  MediaFile,
  TriggerSchema,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { IMAGE_EXTENSIONS } from "@/common/util";
import { showOpenDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, saveFailure } from "@/helper/feedback";
import { sendGamesOverlay, sendGamesRun } from "@/helper/games";
import { AppHandlerVariables } from "@/types";
import { z } from "zod";

// No success notices: the switch shows its state, actions autosave, and the
// page shows a test's results. The Minecraft pictures' changes have them.
const events = createStack("games");

const TestSchema = z.object({
  id: z.string(),
  edition: GameActionSchema.shape.edition,
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
  async (services, e, { settings }) => {
    const res = await services.storeManagerService.updateProfileData({
      games: settings,
    });
    if (!res) throw new LoggedError("The game actions were not saved.");
    services.gamesService.setGames(settings);
    e.reply(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS, { success: true });
    await sendGamesOverlay(services);
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
    const { id, edition, trigger, steps } = TestSchema.parse(data);
    const res = await gamesService.test({ edition, trigger, steps });
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

// The overlay section's Test lights the row up as a run does
events.push(
  APP_EVENTS.TEST_GAMES_OVERLAY,
  (services, _, { id }) => {
    sendGamesRun(services, id);
  },
  { notify: false },
);

events.push(
  APP_EVENTS.GET_MINECRAFT_PICTURES,
  ({ storeManagerService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
      success: true,
      data: storeManagerService.getMinecraftPictures(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.GAME_PICTURES_LOAD_FAILED,
      message: "Unable to load the Minecraft pictures.",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
        success: false,
        data: [],
        error,
      }),
  },
);

// Adds every picture picked, the first going on the action. The picker stays
// open after a pick, so its list gets them too. One bad file doesn't stop the
// others, the service logs each failure. The picker shows a failure itself.
events.push(
  APP_EVENTS.IMPORT_MINECRAFT_PICTURE,
  async ({ win, gamesService, storeManagerService, notifier }, e, { id }) => {
    const diagRes = await showOpenDialog(win, {
      title: "Select pictures",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    if (diagRes.canceled || diagRes.filePaths.length === 0) return;

    const pictures: MediaFile[] = [];
    let failed = 0;
    let error: string | undefined;
    for (const path of diagRes.filePaths) {
      const { data, error: why } = await gamesService.importPicture(path);
      if (!data) {
        failed++;
        error = why;
      } else if (!pictures.some((p) => p.file === data.file)) {
        // Files are named by content: one picked twice is the same picture
        pictures.push(data);
      }
    }
    if (pictures.length === 0) throw new LoggedError(error);

    let saved = true;
    for (const picture of pictures) {
      if (!(await storeManagerService.addMinecraftPicture(picture))) {
        saved = false;
      }
    }
    if (!saved) {
      // What main holds: the pictures stay in its library, unsaved
      e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
        success: true,
        data: storeManagerService.getMinecraftPictures(),
      });
      throw saveFailure();
    }

    e.reply(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id,
      picture: pictures[0],
    });
    e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
      success: true,
      data: storeManagerService.getMinecraftPictures(),
    });
    notifier.success(
      "games",
      FEEDBACK_CODES.GAME_PICTURES_ADDED,
      pictures.length === 1
        ? `Picture "${pictures[0].name}" added.`
        : `${pictures.length} pictures added.`,
    );
    if (failed > 0) {
      notifier.warn(
        "games",
        FEEDBACK_CODES.GAME_PICTURE_IMPORT_FAILED,
        `Unable to use ${failed} of the files. Pick png, jpg, gif or webp files up to 50 MB.`,
      );
    }
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.GAME_PICTURE_IMPORT_FAILED,
      message:
        "Unable to use the file. Pick a png, jpg, gif or webp file up to 50 MB.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
        success: false,
        id,
        error,
      }),
  },
);

// A picture taken out of the library leaves every action that had it, in
// every profile, and the Games page drops it too. Then it's deleted, unless a
// profile couldn't be saved: its actions still need the file. The service
// logs a failed delete. The picker shows its failures itself.
events.push(
  APP_EVENTS.REMOVE_MINECRAFT_PICTURE,
  async (services, e, { file }) => {
    const { gamesService, storeManagerService, notifier } = services;
    if (!(await storeManagerService.removeMinecraftPicture(file))) {
      throw saveFailure();
    }
    const cleared = await storeManagerService.removeFromGames(file);
    e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED, { file });
    if (!cleared) throw saveFailure();
    const deleted = (await gamesService.deletePicture(file)).success;

    e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
      success: true,
      data: storeManagerService.getMinecraftPictures(),
    });
    await sendGamesOverlay(services);
    if (deleted) {
      notifier.success(
        "games",
        FEEDBACK_CODES.GAME_PICTURE_REMOVED,
        "Picture deleted.",
      );
    } else {
      notifier.warn(
        "games",
        FEEDBACK_CODES.GAME_PICTURE_REMOVE_FAILED,
        "Picture removed from the library, but its file couldn't be deleted.",
      );
    }
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.GAME_PICTURE_REMOVE_FAILED,
      message: "Unable to remove the picture.",
    },
    onError: (e, error, _, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
        success: false,
        data: storeManagerService.getMinecraftPictures(),
        error,
      }),
  },
);

export default events;
