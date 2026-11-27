import { ChatEvent, TOKIO_EVENTS } from "@/common/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_TIMES, FakeConnector } from ".";

// Every event the provider sends, in order
const listen = (provider: FakeConnector) => {
  const sent: TOKIO_EVENTS[] = [];
  for (const event of Object.values(TOKIO_EVENTS)) {
    provider.on(event, () => sent.push(event));
  }
  return sent;
};

describe("FakeConnector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects after a moment, sends a made-up LIVE, and stops it", async () => {
    const kick = new FakeConnector("kick");
    const sent = listen(kick);

    const connecting = kick.connect("tokio.demo");
    expect(kick.isConnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(FAKE_TIMES.CONNECT_MS);
    await expect(connecting).resolves.toEqual({ success: true });
    expect(sent).toEqual([TOKIO_EVENTS.CONNECTED, TOKIO_EVENTS.ROOM_USER]);
    expect(kick.channel()).toBe("tokio.demo");

    // The room every 5 s, an event every 0.6 to 2 s
    await vi.advanceTimersByTimeAsync(60_000);
    const rooms = sent.filter((e) => e === TOKIO_EVENTS.ROOM_USER);
    expect(rooms).toHaveLength(13);
    expect(sent.length - rooms.length - 1).toBeGreaterThanOrEqual(25);

    await kick.disconnect();
    expect(kick.isConnected()).toBe(false);
    await vi.runOnlyPendingTimersAsync();
    expect(sent.at(-1)).toBe(TOKIO_EVENTS.DISCONNECTED);
    const total = sent.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(total);
  });

  it("cancels a connect still waiting, sending nothing", async () => {
    const tiktok = new FakeConnector("tiktok");
    const sent = listen(tiktok);

    const connecting = tiktok.connect("");
    await tiktok.disconnect();

    await expect(connecting).resolves.toMatchObject({
      success: false,
      error: { kind: "canceled" },
    });
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
  });

  it("sends chat through Chat translation's stage", async () => {
    const youtube = new FakeConnector("youtube");
    const translation = { text: "hola", from: "en", to: "es" };
    const staged = vi.fn(async (chat: ChatEvent): Promise<ChatEvent> => ({
      ...chat,
      comment: { ...chat.comment, translation },
    }));
    youtube.setChatStage(staged);
    const chats: ChatEvent[] = [];
    youtube.on(TOKIO_EVENTS.CHAT, (chat) => chats.push(chat));

    void youtube.connect("");
    await vi.advanceTimersByTimeAsync(FAKE_TIMES.CONNECT_MS + 30_000);
    await youtube.disconnect();

    expect(staged).toHaveBeenCalled();
    expect(chats).toHaveLength(staged.mock.calls.length);
    for (const chat of chats) {
      expect(chat.comment.translation).toEqual(translation);
    }
  });
});
