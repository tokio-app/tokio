import { GamesOverlayData } from "@/common/types";
import { formatError, GAMES_PATH, gameOverlayRows } from "@/common/util";
import Logger from "@/logger";
import { AppHandlerVariables } from "@/types";

// What the games overlay page (services/server/games.html) reads
const GAMES_OVERLAY = "tokio:games";
const GAMES_RUN = "tokio:games:run";

// Lights the action's row up, for a run or a test
export const sendGamesRun = (
  { serverService }: Pick<AppHandlerVariables, "serverService">,
  id: string,
) => serverService.sendToClient(GAMES_PATH, { type: GAMES_RUN, data: { id } });

const mediaURL = (file: string) =>
  `/${GAMES_PATH}/minecraft/${encodeURIComponent(file)}`;

/**
 * Sends the active profile's game actions and look to the games overlays.
 * Best effort: a failure is logged, never thrown, so it can't fail the
 * change that called it.
 */
export async function sendGamesOverlay({
  storeManagerService,
  overlayService,
  serverService,
  pathManagerService,
}: Pick<
  AppHandlerVariables,
  | "storeManagerService"
  | "overlayService"
  | "serverService"
  | "pathManagerService"
>) {
  try {
    const profile = await storeManagerService.getProfileData();
    if (!profile) return;
    // TikTok's first, so its entry wins for a gift on both lists
    const gifts = [
      ...(await overlayService.getGifts()),
      ...(await overlayService.getCustomGifts()),
    ];
    const data: GamesOverlayData = {
      look: profile.games.overlay,
      rows: gameOverlayRows(profile.games, {
        gifts,
        emotes: profile.emotes,
        mediaURL,
      }),
    };
    serverService.sendToClient(GAMES_PATH, { type: GAMES_OVERLAY, data });
  } catch (error) {
    Logger.error(
      `<Games> Unable to update the games overlay -- ${formatError(error)}`,
      pathManagerService.files.logs.games,
      error,
    );
  }
}
