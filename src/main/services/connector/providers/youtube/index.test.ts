import { TOKIO_EVENTS } from "@/common/types";
import Logger from "@/logger";
import {
  chatAction,
  fakeYouTube,
  giftAction,
  giftCard,
  type FakeYouTube,
} from "@test/youtube";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReconnectState } from "../../common";
import { YouTubeConnector } from "./index";

const VIDEO = "live1234567";

const superChat = {
  addChatItemAction: {
    item: {
      liveChatPaidMessageRenderer: {
        authorName: { simpleText: "@viewer32" },
        authorExternalChannelId: "UCviewer32",
        purchaseAmountText: { simpleText: "$5.00" },
      },
    },
  },
};

describe("YouTubeConnector", () => {
  let youtube: FakeYouTube;
  let connector: YouTubeConnector;
  let states: ReconnectState[];

  const capture = (event: TOKIO_EVENTS) => {
    const listener = vi.fn();
    connector.on(event, listener);
    return listener;
  };
  const chats = (listener: ReturnType<typeof vi.fn>) =>
    listener.mock.calls.map(([chat]) => chat.comment.content);
  const chatPages = () =>
    youtube.state.urls.filter((url) => url.includes("/live_chat?")).length;

  beforeEach(() => {
    youtube = fakeYouTube();
    youtube.state.channels["/@madeup"] = { videoId: VIDEO, author: "Made Up" };
    connector = new YouTubeConnector({
      fetch: youtube.fetch,
      POLL_MS: 5,
      VIEWERS_MS: 50,
      CONNECT_RETRY_MS: 5,
      RECONNECT_MIN_MS: 5,
      RECONNECT_MAX_MS: 20,
    });
    states = [];
    connector.onReconnect((state) => states.push(state));
  });

  afterEach(async () => {
    await connector.disconnect();
  });

  describe("connect", () => {
    it("emits CONNECTED and the viewers", async () => {
      const info = vi.spyOn(Logger, "info");
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const onRoom = capture(TOKIO_EVENTS.ROOM_USER);
      youtube.state.viewers = [264, 300];

      const connecting = connector.connect("madeup");
      expect(connector.connect("madeup")).toBe(connecting);
      expect(await connecting).toEqual({ success: true });

      expect(onConnected).toHaveBeenCalledOnce();
      expect(connector.isConnected()).toBe(true);
      expect(info).toHaveBeenCalledWith(
        `<YouTube> Connected to @madeup's LIVE ${VIDEO}.`,
        expect.anything(),
      );
      await vi.waitFor(() =>
        expect(onRoom).toHaveBeenCalledWith({
          ranks: [],
          viewers: 264,
          views: 0,
        }),
      );
      await vi.waitFor(() =>
        expect(onRoom).toHaveBeenCalledWith({
          ranks: [],
          viewers: 300,
          views: 0,
        }),
      );
    });

    it("connects to a LIVE's link", async () => {
      youtube.state.videos[VIDEO] = "Made Up";

      expect(await connector.connect(`https://youtu.be/${VIDEO}`)).toEqual({
        success: true,
      });
      expect(youtube.state.urls[0]).toContain(`/watch?v=${VIDEO}`);
    });

    it("fails at once offline, not found and with the chat off", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      youtube.state.channels["/@away"] = "offline";

      expect((await connector.connect("away")).error?.kind).toBe("offline");
      expect((await connector.connect("nobody")).error?.kind).toBe("notFound");
      expect(
        (await connector.connect("https://www.youtube.com/feed")).error?.kind,
      ).toBe("notFound");
      expect(youtube.state.urls).toHaveLength(2);

      youtube.state.chatOff = true;
      expect((await connector.connect("madeup")).error?.kind).toBe("noChat");
      expect(youtube.state.urls).toHaveLength(4);
      expect(onConnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(false);
    });

    it("tells a rate limit at once", async () => {
      youtube.state.override = () => new Response("", { status: 429 });

      expect((await connector.connect("madeup")).error?.kind).toBe(
        "rateLimited",
      );
      expect(youtube.state.urls).toHaveLength(1);
    });

    it("tries a page whose body broke again, as the network", async () => {
      youtube.state.override = (url) =>
        url.includes("/@madeup/live")
          ? new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new TypeError("terminated"));
                },
              }),
            )
          : undefined;

      expect((await connector.connect("madeup")).error?.kind).toBe("network");
      expect(youtube.state.urls).toHaveLength(3);
    });

    it("tries a network failure again", async () => {
      let failures = 2;
      youtube.state.override = () => {
        if (failures-- > 0) throw new TypeError("fetch failed");
        return undefined;
      };

      expect(await connector.connect("madeup")).toEqual({ success: true });
    });

    it("gives up on the network after its tries", async () => {
      youtube.state.override = () => {
        throw new TypeError("fetch failed");
      };

      expect((await connector.connect("madeup")).error?.kind).toBe("network");
      expect(youtube.state.urls).toHaveLength(3);
      expect(connector.isConnected()).toBe(false);
    });

    it("calls a connect a Disconnect stopped canceled", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const connecting = connector.connect("madeup");
      await connector.disconnect();

      expect(await connecting).toMatchObject({
        success: false,
        error: { kind: "canceled" },
      });
      expect(onConnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(false);
    });

    it("calls a connect stopped while it waits to try again canceled", async () => {
      youtube.state.override = () => {
        setTimeout(() => void connector.disconnect(), 0);
        throw new TypeError("fetch failed");
      };

      expect((await connector.connect("madeup")).error?.kind).toBe("canceled");
      expect(youtube.state.urls).toHaveLength(1);
    });

    it("starts over on a Connect right after a Disconnect, while the stopped one finishes", async () => {
      const first = connector.connect("madeup");
      await connector.disconnect();
      const again = connector.connect("madeup");

      expect((await first).error?.kind).toBe("canceled");
      expect(await again).toEqual({ success: true });
      expect(connector.isConnected()).toBe(true);
    });
  });

  describe("the chat", () => {
    it("drops the first answer's history and sends what comes after", async () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);
      const onSuperChat = capture(TOKIO_EVENTS.SUPER_CHAT);
      youtube.state.polls = [
        { actions: [chatAction("old"), superChat] },
        { actions: [chatAction("new"), superChat] },
      ];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(onSuperChat).toHaveBeenCalled());
      expect(chats(onChat)).toEqual(["new"]);
      expect(onSuperChat).toHaveBeenCalledOnce();
      expect(onSuperChat.mock.calls[0][0]).toMatchObject({ amount: "$5.00" });
      // Live chat's continuation, then each answer's next
      expect(youtube.state.continuations.slice(0, 3)).toEqual([
        "live-0",
        "next-1",
        "next-2",
      ]);
    });

    it("sends a Gift under the channel id its handle chatted with, else under @handle", async () => {
      const onGift = capture(TOKIO_EVENTS.GIFT);
      const gift = (handle: string) => ({
        addChatItemAction: {
          item: {
            giftMessageViewModel: {
              text: { content: "sent Vice City heart" },
              authorName: { content: handle },
              giftImage: { sources: [{ url: "//x/gift/assets/heart.png" }] },
            },
          },
        },
      });
      const paid = (handle: string, channel: string) => ({
        addChatItemAction: {
          item: {
            liveChatPaidMessageRenderer: {
              authorName: { simpleText: handle },
              authorExternalChannelId: channel,
              purchaseAmountText: { simpleText: "$5.00" },
            },
          },
        },
      });
      youtube.state.polls = [
        // The history's chat counts too, though it isn't sent
        { actions: [chatAction("old")] },
        {
          actions: [
            gift("@Viewer32"),
            paid("@payer", "UCpayer"),
            gift("@payer"),
            gift("@stranger"),
          ],
        },
      ];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(onGift).toHaveBeenCalledTimes(3));
      expect(onGift.mock.calls.map(([e]) => e.user.userId)).toEqual([
        "youtube:UCviewer32",
        "youtube:UCpayer",
        "youtube:@stranger",
      ]);
      expect(onGift.mock.calls[0][0].user.handle).toBe("Viewer32");
    });

    it("sends a Gift under the channel id its card names", async () => {
      const onGift = capture(TOKIO_EVENTS.GIFT);
      const star = (handle: string) =>
        giftAction(handle, "sent Star", "silver_star_v2_320x320");
      youtube.state.polls = [
        // The history's cards count too
        { actions: [giftCard("Early", "UCearly"), star("Early")] },
        {
          actions: [
            giftCard("Giver", "UCgiver"),
            // A card again for the same Gift: still one Gift
            giftCard("Giver", "UCgiver"),
            star("Giver"),
            star("early"),
          ],
        },
      ];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(onGift).toHaveBeenCalledTimes(2));
      expect(onGift.mock.calls.map(([e]) => e.user.userId)).toEqual([
        "youtube:UCgiver",
        "youtube:UCearly",
      ]);
      expect(onGift.mock.calls[0][0].gift.coins).toBe(2);
    });

    it("keeps a combo's price for the LIVE, and logs a Gift without one once", async () => {
      const info = vi.spyOn(Logger, "info");
      const onGift = capture(TOKIO_EVENTS.GIFT);
      const elote = (text: string) => giftAction("viewer32", text, "elote");
      youtube.state.polls = [
        { actions: [] },
        { actions: [elote("sent Elote"), elote("sent Elote")] },
        {
          actions: [
            elote("comboed x2 Elote for 30 Jewels"),
            elote("sent Elote"),
          ],
        },
      ];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(onGift).toHaveBeenCalledTimes(4));
      expect(
        onGift.mock.calls.map(([e]) => [e.gift.coins, e.gift.comboCount]),
      ).toEqual([
        [0, 1],
        [0, 1],
        [15, 2],
        [15, 1],
      ]);
      const logged = info.mock.calls.filter(([line]) =>
        line.includes("No price"),
      );
      expect(logged).toEqual([
        ["<YouTube> No price for the Gift Elote (elote).", expect.anything()],
      ]);
    });

    it("sends chat through the chat stage", async () => {
      connector.setChatStage((chat) =>
        Promise.resolve({
          ...chat,
          comment: { ...chat.comment, content: `${chat.comment.content}!` },
        }),
      );
      const onChat = capture(TOKIO_EVENTS.CHAT);
      youtube.state.polls = [{ actions: [] }, { actions: [chatAction("hi")] }];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(chats(onChat)).toEqual(["hi!"]));
    });

    it("stops with ended when the chat ends", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      youtube.state.polls = [{ actions: [] }, "ended"];
      await connector.connect("madeup");

      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
      expect(connector.isConnected()).toBe(false);
    });

    it("stops with ended once the viewers turn into the video's views", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      const onRoom = capture(TOKIO_EVENTS.ROOM_USER);
      youtube.state.viewers = ["ended"];
      await connector.connect("madeup");

      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
      expect(onRoom).not.toHaveBeenCalled();
    });

    it("reconnects after failed polls with the same continuation", async () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      youtube.state.polls = [
        { actions: [] },
        503,
        new TypeError("fetch failed"),
        429,
        { actions: [chatAction("back")] },
      ];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(states).toContain("reconnected"));
      // The drop, then once per try
      expect(states).toEqual([
        "reconnecting",
        "reconnecting",
        "reconnecting",
        "reconnecting",
        "reconnected",
      ]);
      expect(connector.isReconnecting()).toBe(false);
      expect(youtube.state.continuations.slice(1, 5)).toEqual([
        "next-1",
        "next-1",
        "next-1",
        "next-1",
      ]);
      await vi.waitFor(() => expect(chats(onChat)).toEqual(["back"]));
      expect(chatPages()).toBe(1);
      expect(onDisconnected).not.toHaveBeenCalled();
    });

    it("reads the chat page again for a continuation YouTube refused", async () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);
      youtube.state.polls = [
        { actions: [] },
        403,
        // The fresh continuation's history again
        { actions: [chatAction("old")] },
        { actions: [chatAction("fresh")] },
      ];
      await connector.connect("madeup");

      await vi.waitFor(() => expect(chats(onChat)).toEqual(["fresh"]));
      expect(chatPages()).toBe(2);
      expect(youtube.state.continuations.slice(0, 4)).toEqual([
        "live-0",
        "next-1",
        "live-0",
        "next-2",
      ]);
      expect(states).toEqual(["reconnecting", "reconnecting", "reconnected"]);
    });
  });

  it("stops polling on disconnect and emits DISCONNECTED after the events sent", async () => {
    const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
    await connector.connect("madeup");
    await vi.waitFor(() =>
      expect(youtube.state.continuations.length).toBeGreaterThan(2),
    );

    await connector.disconnect();
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(connector.isConnected()).toBe(false);
    const polls = youtube.state.continuations.length;

    await new Promise((r) => setImmediate(r));
    expect(onDisconnected).toHaveBeenCalledWith(undefined);
    await new Promise((r) => setTimeout(r, 30));
    // One in flight at most
    expect(youtube.state.continuations.length).toBeLessThanOrEqual(polls + 1);
  });

  it("has no gifts and ignores keys", async () => {
    connector.setKey();
    expect(await connector.fetchGifts()).toEqual({ success: true, data: [] });
    expect(connector.isWaiting()).toBe(false);
  });
});
