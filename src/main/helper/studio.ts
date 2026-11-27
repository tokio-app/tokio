import { StudioElementOf, StudioOverlay, StudioSource } from "@/common/schemas";
import {
  CustomGift,
  Gifter,
  STUDIO_MESSAGE,
  STUDIO_REACT_MESSAGE,
  StudioMessage,
  StudioNumbers,
  StudioReact,
  StudioListEntry,
  StudioView,
} from "@/common/types";
import {
  alertMediaPath,
  ALERTS_PATH,
  formatError,
  goalValue,
  listInJewels,
  listInUsd,
  listRow,
  MINECRAFT_OVERLAY_PATH,
  sampleCounts,
  sampleDeps,
  Samples,
  studioCameraPath,
  studioElements,
  studioSocketId,
  sentPicture,
  studioView,
  TIMER_PATH,
  usesNumbers,
} from "@/common/util";
import { language } from "@/helper/i18n";
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
  | "historyService"
  | "pathManagerService"
>;

type History = Services["historyService"];
// One push's tops, each ranked on the first list that needs it
type Tops = {
  gifters: () => ReturnType<History["topByPlatform"]>;
  giftsubs: () => ReturnType<History["topSubGifters"]>;
  jewels: () => ReturnType<History["topJewelGifters"]>;
};

const topsOf = (history: History): Tops => {
  let gifters: ReturnType<History["topByPlatform"]> | undefined;
  let giftsubs: ReturnType<History["topSubGifters"]> | undefined;
  let jewels: ReturnType<History["topJewelGifters"]> | undefined;
  return {
    gifters: () => (gifters ??= history.topByPlatform()),
    giftsubs: () => (giftsubs ??= history.topSubGifters()),
    jewels: () => (jewels ??= history.topJewelGifters()),
  };
};

// A top list's rows: who sent the most of the platform's money, with an
// amount, or who gifted the most subs, apart (the user's call), or who sent
// YouTube's Gifts, by their Jewels
const topOf = (
  tops: Tops,
  list: Pick<StudioElementOf<"list">, "source" | "platform" | "rank">,
): StudioListEntry[] => {
  const { source, platform } = list;
  if (source === "giftsubs") {
    return (tops.giftsubs()[platform] ?? []).map((g) => topRow(g, g.giftSubs));
  }
  if (listInJewels(list)) {
    return (tops.jewels()[platform] ?? []).map((g) => topRow(g, g.jewels ?? 0));
  }
  return (tops.gifters()[platform] ?? [])
    .filter((g) => g.coins > 0)
    .map((g) => topRow(g, g.coins));
};

const topRow = (gifter: Gifter, value: number): StudioListEntry => ({
  picture: gifter.picture,
  name: gifter.username || gifter.handle,
  text: "",
  icon: "",
  value,
});

/**
 * The live numbers studio texts show: the LIVE's likes and viewers, the
 * session's totals and how long it has run, 0 while not LIVE so they reset
 * with the others.
 */
export function liveNumbers(
  {
    storeManagerService,
    liveService,
  }: Pick<Services, "storeManagerService" | "liveService">,
  now = Date.now(),
): StudioNumbers {
  const { likes, viewers } = storeManagerService.getLiveStats();
  const session = liveService.getSession();
  const { startedAt, totals } = session;
  const live = startedAt !== null;
  return {
    likes,
    viewers,
    followers: live ? totals.followers : 0,
    shares: live ? totals.shares : 0,
    coins: live ? totals.coins : 0,
    jewels: live ? totals.jewels : 0,
    kicks: live ? totals.kicks : 0,
    bits: live ? totals.bits : 0,
    superchats: live ? session.usd : 0,
    gifts: live ? totals.gifts : 0,
    giftsubs: live ? totals.giftSubs : 0,
    uptime: live ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0,
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

function viewOf(
  overlay: StudioOverlay,
  services: Services,
  gifts: CustomGift[],
  served: Set<string>,
  numbers: StudioNumbers,
  tops: Tops,
): StudioView {
  const { studioService: studio } = services;
  return studioView(overlay, {
    gifts,
    served: (id) => served.has(id),
    mediaURL: alertMediaPath,
    embedPath,
    camera: (element) =>
      studioCameraPath(
        services.serverService.cameraKey,
        element.camera,
        element.quality,
      ),
    text: (element) =>
      studioText(
        element,
        numbers,
        studio.counts(overlay),
        studio.kept(overlay.id, element)?.values ?? null,
      ),
    viewer: (element) => {
      const kept = studio.kept(overlay.id, element);
      return { src: kept?.picture ?? "", name: kept?.name ?? "" };
    },
    sent: (element) =>
      sentPicture(element, studio.kept(overlay.id, element)?.values ?? null),
    fill: (element) =>
      goalValue(element.number, numbers, studio.counts(overlay)) / element.goal,
    // This LIVE's top gifters on the list's platform, by its money alone or
    // by gifted subs, else the newest first
    rows: (list) =>
      (list.source === "gifters" || list.source === "giftsubs"
        ? topOf(tops, list)
        : studio.list(list.source)
      ).map((entry) => listRow(entry, language(), listInUsd(list))),
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

// Whether it shows something the LIVE changes, sent again as it does: a
// text with a live number or one of its counters, a goal bar or a list
export const showsNumbers = (overlay: StudioOverlay) =>
  studioElements(overlay).some(
    (e) =>
      e.kind === "bar" ||
      e.kind === "list" ||
      (e.kind === "text" &&
        (usesNumbers(e.text) ||
          overlay.counters.some((c) => e.text.includes(`{${c.name}}`)))),
  );

// Whether one of its texts shows {uptime}, sent again every second while LIVE
export const showsUptime = (overlay: StudioOverlay) =>
  studioElements(overlay).some(
    (e) => e.kind === "text" && e.text.includes("{uptime}"),
  );

// The gifts a view draws, and the ids of the overlays Tokio serves
const giftsAndServed = async (
  overlayService: Pick<
    Services["overlayService"],
    "getGifts" | "getCustomGifts" | "getOverlays"
  >,
) => ({
  // TikTok's first, so its entry wins for a gift on both lists
  gifts: [
    ...(await overlayService.getGifts()),
    ...(await overlayService.getCustomGifts()),
  ],
  served: new Set(overlayService.getOverlays().map((o) => o.id)),
});

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

    const { gifts, served } = await giftsAndServed(services.overlayService);
    // After the awaits, so a push can't show a LIVE that ended meanwhile
    const numbers = liveNumbers(services);
    const tops = topsOf(services.historyService);
    for (const overlay of overlays) {
      const view = viewOf(overlay, services, gifts, served, numbers, tops);
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

/**
 * An overlay's view with the samples Test plays instead of the LIVE's
 * values, for MCP's preview. No camera turns on for it.
 */
export async function studioSampleView(
  {
    overlayService,
    storeManagerService,
  }: Pick<Services, "overlayService" | "storeManagerService">,
  overlay: StudioOverlay,
): Promise<StudioView> {
  const profile = await storeManagerService.getProfileData();
  const { gifts, served } = await giftsAndServed(overlayService);
  return studioView(overlay, {
    gifts,
    served: (id) => served.has(id),
    mediaURL: alertMediaPath,
    embedPath,
    camera: () => null,
    label: () => "",
    ...sampleDeps(
      new Samples(profile?.platforms ?? ["tiktok"]),
      language(),
      sampleCounts(overlay),
    ),
  });
}
