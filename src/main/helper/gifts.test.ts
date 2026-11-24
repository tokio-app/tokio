import { APP_EVENTS_RESPONSE, FEEDBACK_CODES } from "@/common/types";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import { sendGamesOverlay } from "./games";
import { giftsFetched, refreshTikTokGifts, usesTikTok } from "./gifts";
import { sendStudioOverlays } from "./studio";

vi.mock("./games", () => ({ sendGamesOverlay: vi.fn(async () => {}) }));
vi.mock("./studio", () => ({ sendStudioOverlays: vi.fn(async () => {}) }));

const rose = { id: 5655, name: "Rose", coins: 1, image: "rose.png" };
const overlayRose = { value: 5655, label: "Rose", img: "rose.png", coins: 1 };

function setup() {
  const connectorService = {
    fetchGifts: vi.fn(async () => ({ success: true, data: [rose] })),
  };
  const overlayService = {
    refreshGifts: vi.fn(async (_gifts: unknown) => {}),
    getGifts: vi.fn(async () => [overlayRose]),
  };
  const h = createHandler({ connectorService, overlayService });
  return { h, connectorService, overlayService };
}

describe("refreshTikTokGifts", () => {
  it("updates the overlays and the open pages with TikTok's gifts", async () => {
    const { h, overlayService } = setup();

    await refreshTikTokGifts(h.handler);

    expect(overlayService.refreshGifts).toHaveBeenCalledExactlyOnceWith([
      overlayRose,
    ]);
    expect(sendGamesOverlay).toHaveBeenCalledWith(h.handler);
    expect(sendStudioOverlays).toHaveBeenCalledWith(h.handler);
    expect(h.pushed(APP_EVENTS_RESPONSE.GET_GIFTS)).toEqual([
      { data: [overlayRose] },
    ]);
  });

  it("asks TikTok once a run, however many times it's called", async () => {
    const { h, connectorService } = setup();

    await Promise.all([
      refreshTikTokGifts(h.handler),
      refreshTikTokGifts(h.handler),
    ]);
    await refreshTikTokGifts(h.handler);

    expect(connectorService.fetchGifts).toHaveBeenCalledOnce();
  });

  it("doesn't ask again after startup fetched them", async () => {
    const { h, connectorService } = setup();

    giftsFetched(h.handler);
    await refreshTikTokGifts(h.handler);

    expect(connectorService.fetchGifts).not.toHaveBeenCalled();
  });

  it("asks again next time when TikTok sent none, without a notice", async () => {
    const { h, connectorService, overlayService } = setup();
    connectorService.fetchGifts.mockResolvedValueOnce({
      success: false,
      data: [],
    });

    await refreshTikTokGifts(h.handler);
    expect(overlayService.refreshGifts).not.toHaveBeenCalled();
    expect(h.notices).toEqual([]);

    await refreshTikTokGifts(h.handler);
    expect(connectorService.fetchGifts).toHaveBeenCalledTimes(2);
    expect(overlayService.refreshGifts).toHaveBeenCalledOnce();
  });

  it("warns when the new gifts can't be saved, and tries again next time", async () => {
    const { h, connectorService, overlayService } = setup();
    overlayService.refreshGifts.mockRejectedValueOnce(new Error("EACCES"));

    await refreshTikTokGifts(h.handler);

    expect(h.notices).toEqual([
      expect.objectContaining({
        level: "warning",
        source: "overlays",
        code: FEEDBACK_CODES.GIFTS_FETCH_FAILED,
      }),
    ]);
    await refreshTikTokGifts(h.handler);
    expect(connectorService.fetchGifts).toHaveBeenCalledTimes(2);
  });
});

describe("usesTikTok", () => {
  it("is a profile with TikTok among its platforms", () => {
    expect(usesTikTok(["kick", "tiktok"])).toBe(true);
    expect(usesTikTok(["twitch", "youtube", "kick"])).toBe(false);
  });
});
