import { StudioOverlay, StudioSource } from "@/common/schemas";
import {
  CustomGift,
  STUDIO_MESSAGE,
  STUDIO_REACT_MESSAGE,
  StudioMessage,
  StudioNumbers,
  StudioReact,
  StudioView,
} from "@/common/types";
import {
  ALERTS_PATH,
  formatError,
  MINECRAFT_OVERLAY_PATH,
  studioElements,
  studioSocketId,
  studioView,
  TIMER_PATH,
  usesNumbers,
} from "@/common/util";
import Logger from "@/logger";
import { studioText } from "@/services/studio";
import { AppHandlerVariables } from "@/types";

type Services = Pick<
  AppHandlerVariables,
  | "storeManagerService"
  | "overlayService"
  | "serverService"
  | "liveService"
  | "studioService"
  | "pathManagerService"
>;

/**
 * The live numbers studio texts show: the LIVE's likes and viewers, and the
 * session's totals, 0 while not LIVE so they reset with the others.
 */
export function liveNumbers({
  storeManagerService,
  liveService,
}: Pick<Services, "storeManagerService" | "liveService">): StudioNumbers {
  const { likes, viewers } = storeManagerService.getLiveStats();
  const { startedAt, totals } = liveService.getSession();
  const live = startedAt !== null;
  return {
    likes,
    viewers,
    followers: live ? totals.followers : 0,
    shares: live ? totals.shares : 0,
    coins: live ? totals.coins : 0,
  };
}

// Where the overlay server serves an embed
const embedPath = (source: StudioSource) => {
  if (source.type === "installed") return `/${encodeURIComponent(source.id)}/`;
  if (source.type === "alert") {
    return `/${ALERTS_PATH}/${encodeURIComponent(source.id)}/`;
  }
  if (source.type === "timer") return `/${TIMER_PATH}/`;
  // One column's page, or every column's
  return source.column === null
    ? `/${MINECRAFT_OVERLAY_PATH}/`
    : `/${MINECRAFT_OVERLAY_PATH}/${source.column}/`;
};

// The media library, as the server mounts it for the alerts' pages
const mediaURL = (file: string) =>
  `/${ALERTS_PATH}/media/${encodeURIComponent(file)}`;

function viewOf(
  overlay: StudioOverlay,
  services: Services,
  gifts: CustomGift[],
  served: Set<string>,
  numbers: StudioNumbers,
): StudioView {
  const { studioService: studio } = services;
  return studioView(overlay, {
    gifts,
    served: (id) => served.has(id),
    mediaURL,
    embedPath,
    text: (element) =>
      studioText(element, numbers, studio.kept(element)?.values ?? null),
    viewer: (element) => {
      const kept = studio.kept(element);
      return { src: kept?.picture ?? "", name: kept?.name ?? "" };
    },
    // The page doesn't show it; the editor names embeds itself
    label: () => "",
  });
}

/** Tells a studio overlay's page what to draw, null once it's removed. */
export const sendStudioMessage = (
  { serverService }: Pick<Services, "serverService">,
  id: string,
  message: StudioMessage,
) =>
  serverService.sendToClient(studioSocketId(id), {
    type: STUDIO_MESSAGE,
    data: message,
  });

/** Plays an element's reaction on its overlay's page. */
export const sendStudioReact = (
  { serverService }: Pick<Services, "serverService">,
  id: string,
  react: StudioReact,
) =>
  serverService.sendToClient(studioSocketId(id), {
    type: STUDIO_REACT_MESSAGE,
    data: react,
  });

// Whether one of its texts shows a live number, sent again as they change
export const showsNumbers = (overlay: StudioOverlay) =>
  studioElements(overlay).some((e) => e.kind === "text" && usesNumbers(e.text));

/**
 * Sends the studio overlays' pages what to draw: every overlay, or those
 * `only` keeps. Best effort: a failure is logged, never thrown, so it can't
 * fail the change that called it.
 */
export async function sendStudioOverlays(
  services: Services,
  only: (overlay: StudioOverlay) => boolean = () => true,
) {
  try {
    const overlays = services.storeManagerService.getStudio().filter(only);
    if (overlays.length === 0) return;

    const { overlayService } = services;
    // TikTok's first, so its entry wins for a gift on both lists
    const gifts = [
      ...(await overlayService.getGifts()),
      ...(await overlayService.getCustomGifts()),
    ];
    const served = new Set(overlayService.getOverlays().map((o) => o.id));
    const numbers = liveNumbers(services);
    for (const overlay of overlays) {
      const view = viewOf(overlay, services, gifts, served, numbers);
      sendStudioMessage(services, overlay.id, { view });
    }
  } catch (error) {
    Logger.error(
      `<Studio> Unable to update the studio overlays -- ${formatError(error)}`,
      services.pathManagerService.files.logs.overlays,
      error,
    );
  }
}

/**
 * Sends one studio overlay's page what to draw, { view: null } when there's
 * no such overlay. Never throws, like sendStudioOverlays.
 */
export async function sendStudioOverlay(services: Services, id: string) {
  try {
    if (!services.storeManagerService.getStudio().some((o) => o.id === id)) {
      sendStudioMessage(services, id, { view: null });
      return;
    }
  } catch (error) {
    Logger.error(
      `<Studio> Unable to update studio overlay ${id} -- ${formatError(error)}`,
      services.pathManagerService.files.logs.overlays,
      error,
    );
    return;
  }
  await sendStudioOverlays(services, (o) => o.id === id);
}
