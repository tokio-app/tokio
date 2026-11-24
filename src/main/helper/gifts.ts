import {
  APP_EVENTS_RESPONSE,
  CustomGift,
  FEEDBACK_CODES,
  Platform,
} from "@/common/types";
import type { ConnectorService } from "@/services/connector";
import { AppHandlerVariables } from "@/types";
import { AppFailure } from "./feedback";
import { sendGamesOverlay } from "./games";
import { t } from "./i18n";
import { sendStudioOverlays } from "./studio";

/** TikTok's gifts in the shape overlays use, none when TikTok can't be reached. */
export const fetchOverlayGifts = async (
  conn: ConnectorService,
): Promise<CustomGift[]> => {
  const gifts = await conn.fetchGifts();
  if (!gifts.success) return [];
  return gifts.data.map((g) => ({
    value: g.id,
    label: g.name,
    img: g.image,
    coins: g.coins,
  }));
};

// Only a profile with TikTok asks TikTok for its gifts (the user's call)
export const usesTikTok = (platforms: readonly Platform[]) =>
  platforms.includes("tiktok");

// This run's fetch, by handler: a second trigger waits on the same one
const fetches = new WeakMap<object, Promise<void>>();

/** Startup fetched the list itself, before the overlays loaded. */
export const giftsFetched = (handler: object) =>
  fetches.set(handler, Promise.resolve());

/**
 * Updates TikTok's gift list once a run, from the first time a profile with
 * TikTok is active: at startup, when Home adds TikTok, or on a switch to such
 * a profile. Overlays, the games and Studio overlays and the open pages get
 * it. A failed fetch is tried again by the next trigger.
 */
export function refreshTikTokGifts(
  handler: AppHandlerVariables,
): Promise<void> {
  const running = fetches.get(handler);
  if (running) return running;
  const run = (async () => {
    const gifts = await fetchOverlayGifts(handler.connectorService);
    if (gifts.length === 0) {
      fetches.delete(handler);
      return;
    }
    await handler.overlayService.refreshGifts(gifts);
    // Gift pictures may have changed. Before this, the games and studio
    // overlays get the saved ones when they connect.
    await sendGamesOverlay(handler);
    await sendStudioOverlays(handler);
    // Pages ask for the list only when they open
    if (!handler.win.isDestroyed()) {
      handler.win.webContents.send(APP_EVENTS_RESPONSE.GET_GIFTS, {
        data: await handler.overlayService.getGifts(),
      });
    }
  })().catch((error: unknown) => {
    fetches.delete(handler);
    handler.notifier.report({
      source: "overlays",
      error: new AppFailure(
        FEEDBACK_CODES.GIFTS_FETCH_FAILED,
        t("main.init.giftsRefreshFailed"),
        { level: "warning", cause: error },
      ),
    });
  });
  fetches.set(handler, run);
  return run;
}
