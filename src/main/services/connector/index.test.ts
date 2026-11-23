import {
  ChatEvent,
  Platform,
  RoomUserEvent,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { generateTikTokEventSample } from "@/common/util";
import Logger from "@/logger";
import { describe, expect, it, vi } from "vitest";
import {
  AccountProvider,
  connectFailure,
  ConnectorProvider,
  ConnectorResponse,
  DeviceCode,
  GiftResponse,
  PlatformAccount,
  ReconnectState,
} from "./common";
import { ConnectorService } from "./index";

class FakeConnector extends ConnectorProvider {
  setKey = vi.fn();
  connect = vi.fn(async (): Promise<ConnectorResponse> => ({ success: true }));
  disconnect = vi.fn(async () => {});
  isConnected = vi.fn(() => true);
  fetchGifts = vi.fn(async (): Promise<GiftResponse> => ({
    success: true,
    data: [],
  }));
  fire<K extends TOKIO_EVENTS>(event: K, data?: TokioEventMap[K]) {
    this.emit(event, data);
  }
  chat(data: ChatEvent, current = () => true) {
    this.emitChat(data, current);
  }
  reconnect(state: ReconnectState) {
    this._onReconnect?.(state);
  }
}

// Twitch's provider stands in for any other platform's
class FakeAccountConnector extends FakeConnector implements AccountProvider {
  setAccount = vi.fn((_account: PlatformAccount) => {});
  onAccount = vi.fn(
    (_listener: (account: PlatformAccount) => Promise<boolean>) => {},
  );
  signIn = vi.fn(
    async (_onCode: (code: DeviceCode) => void, _signal: AbortSignal) =>
      account,
  );
  signOut = vi.fn(async () => {});
}

class TestService extends ConnectorService {
  add(platform: Platform, provider: ConnectorProvider) {
    this._addPlatform(platform, provider);
  }
}

const account: PlatformAccount = {
  id: "twitch:1",
  login: "mia",
  key: "refresh",
};

const viewer = generateTikTokEventSample(TOKIO_EVENTS.CHAT).data.user;
const chatOf = (content: string, lang = "en"): ChatEvent => ({
  user: viewer,
  comment: { content, emotes: [], lang },
});

const setup = () => {
  const service = new ConnectorService();
  service.setLogFile("connector.log");
  const provider = new FakeConnector();
  service.addProvider("Fake", provider, true);
  return { service, provider };
};

describe("ConnectorService", () => {
  it("connects through the active provider and logs it", async () => {
    const debug = vi.spyOn(Logger, "debug");
    const info = vi.spyOn(Logger, "info");
    const { service, provider } = setup();

    const res = await service.connect({ tiktok: "streamer" });

    expect(res).toEqual({ success: true });
    expect(provider.connect).toHaveBeenCalledWith("streamer");
    expect(debug).toHaveBeenCalledWith(
      "<Connector> Connecting to: streamer",
      "connector.log",
    );
    expect(info).toHaveBeenCalledWith(
      "<Connector> Connected to streamer.",
      "connector.log",
    );
  });

  it("knows the username before the provider connects", async () => {
    const { service, provider } = setup();
    let during = "";
    provider.connect.mockImplementation(async () => {
      during = service.username;
      return { success: true };
    });

    expect(service.username).toBe("");
    await service.connect({ tiktok: "streamer" });
    await service.connect({ tiktok: "other" });

    expect(during).toBe("other");
    expect(service.username).toBe("other");
  });

  it("logs and returns a failed connection, in one line for a known kind", async () => {
    const error = vi.spyOn(Logger, "error");
    const { service, provider } = setup();
    const cause = connectFailure("offline", "User is offline");
    provider.connect.mockResolvedValue({ success: false, error: cause });

    const res = await service.connect({ tiktok: "streamer" });

    expect(res).toEqual({ success: false, error: cause });
    expect(error).toHaveBeenCalledWith(
      "<Connector> Unable to connect to streamer -- User is offline",
      "connector.log",
      undefined,
    );
  });

  it("logs the stack of a failed connection it didn't expect", async () => {
    const error = vi.spyOn(Logger, "error");
    const { service, provider } = setup();
    const cause = connectFailure("unknown", "Something broke");
    provider.connect.mockResolvedValue({ success: false, error: cause });

    await service.connect({ tiktok: "streamer" });

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Something broke"),
      "connector.log",
      cause,
    );
  });

  it("passes everything else to the active provider", async () => {
    const { service, provider } = setup();
    const listener = vi.fn();
    const onReconnect = vi.fn();
    const follow = generateTikTokEventSample(TOKIO_EVENTS.FOLLOW).data;

    service.on(TOKIO_EVENTS.FOLLOW, listener);
    service.onReconnect(onReconnect);
    provider.fire(TOKIO_EVENTS.FOLLOW, follow);
    service.off(TOKIO_EVENTS.FOLLOW, listener);
    provider.fire(TOKIO_EVENTS.FOLLOW, follow);
    provider.reconnect("reconnecting");
    await service.disconnect();

    expect(listener).toHaveBeenCalledExactlyOnceWith(follow);
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith(
      "reconnecting",
      "tiktok",
    );
    expect(provider.disconnect).toHaveBeenCalledOnce();
    expect(service.isConnected()).toBe(true);
    expect(await service.fetchGifts()).toEqual({ success: true, data: [] });
  });

  it("forwards only the current provider's events, whoever listened first", () => {
    const service = new ConnectorService();
    const received = vi.fn();
    const reconnect = vi.fn();
    service.on(TOKIO_EVENTS.FOLLOW, received);
    service.onReconnect(reconnect);
    const first = new FakeConnector();
    const second = new FakeConnector();
    const follow = generateTikTokEventSample(TOKIO_EVENTS.FOLLOW).data;

    service.addProvider("First", first, true);
    service.addProvider("Second", second, true);
    first.fire(TOKIO_EVENTS.FOLLOW, follow);
    first.reconnect("reconnecting");
    second.fire(TOKIO_EVENTS.FOLLOW, follow);
    second.reconnect("reconnected");

    expect(received).toHaveBeenCalledExactlyOnceWith(follow);
    expect(reconnect).toHaveBeenCalledExactlyOnceWith("reconnected", "tiktok");
  });

  it("gives every listener a Super Chat's dollars, null without rates or a readable amount", () => {
    const { service, provider } = setup();
    const first = vi.fn();
    const second = vi.fn();
    service.on(TOKIO_EVENTS.SUPER_CHAT, first);
    service.on(TOKIO_EVENTS.SUPER_CHAT, second);
    const chat = (amount: string) => ({
      user: viewer,
      amount,
      message: "hi",
      sticker: "",
    });

    // Before setRates, as before the rates load
    provider.fire(TOKIO_EVENTS.SUPER_CHAT, chat("MX$100.00"));
    let loaded = false;
    const toUsd = vi.fn((amounts: Record<string, number>) =>
      loaded ? (amounts.MXN ?? 0) / 20 : null,
    );
    service.setRates({ toUsd });
    provider.fire(TOKIO_EVENTS.SUPER_CHAT, chat("MX$100.00"));
    loaded = true;
    provider.fire(TOKIO_EVENTS.SUPER_CHAT, chat("MX$100.00"));
    provider.fire(TOKIO_EVENTS.SUPER_CHAT, chat("100 bananas"));

    expect(first.mock.calls.map(([d]) => d.usd)).toEqual([null, null, 5, null]);
    expect(first.mock.calls[2][0]).toEqual({ ...chat("MX$100.00"), usd: 5 });
    expect(second.mock.calls).toEqual(first.mock.calls);
    expect(toUsd).toHaveBeenCalledWith({ MXN: 100 });
  });

  it("logs gifts it can't fetch", async () => {
    const warn = vi.spyOn(Logger, "warn");
    const { service, provider } = setup();
    const failed = { success: false, data: [], error: new Error("Offline") };
    provider.fetchGifts.mockResolvedValue(failed);

    expect(await service.fetchGifts()).toEqual(failed);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "<Connector> Unable to fetch gifts -- Offline",
      "connector.log",
    );
  });

  it("gives its providers its log file", () => {
    const { service, provider } = setup();
    const setLogFile = vi.spyOn(provider, "setLogFile");

    service.setLogFile("other.log");

    expect(setLogFile).toHaveBeenCalledWith("other.log");
  });

  it("logs each event at debug, without a chat's text or room users", () => {
    const debug = vi.spyOn(Logger, "debug");
    const { provider } = setup();
    provider.setLogFile("connector.log");
    const user = {
      ...generateTikTokEventSample(TOKIO_EVENTS.FOLLOW).data.user,
    };
    user.handle = "handle";
    const gift = generateTikTokEventSample(TOKIO_EVENTS.GIFT).data;
    const chat = generateTikTokEventSample(TOKIO_EVENTS.CHAT).data;
    const received = vi.fn();
    provider.on(TOKIO_EVENTS.GIFT, received);

    provider.fire(TOKIO_EVENTS.GIFT, {
      user,
      gift: { ...gift.gift, name: "Rose", comboCount: 5, repeatEnd: true },
    });
    provider.fire(TOKIO_EVENTS.CHAT, {
      user,
      comment: { ...chat.comment, content: "secret" },
    });
    provider.fire(
      TOKIO_EVENTS.ROOM_USER,
      generateTikTokEventSample(TOKIO_EVENTS.ROOM_USER).data,
    );
    provider.fire(TOKIO_EVENTS.CONNECTED);

    expect(received).toHaveBeenCalledOnce();
    expect(debug.mock.calls).toEqual([
      [
        "<Connector> tokio:event:gift Rose x5 (end) from @handle",
        "connector.log",
      ],
      ["<Connector> tokio:event:chat from @handle", "connector.log"],
      [`<Connector> ${TOKIO_EVENTS.CONNECTED}`, "connector.log"],
    ]);
  });

  describe("the chat stage", () => {
    it("sends a chat on in the same tick without a stage, or when it gives null", () => {
      const { service, provider } = setup();
      const received = vi.fn();
      service.on(TOKIO_EVENTS.CHAT, received);

      provider.chat(chatOf("hi"));
      const stage = vi.fn(() => null);
      service.setChatStage(stage);
      provider.chat(chatOf("hello"));

      expect(stage).toHaveBeenCalledExactlyOnceWith(chatOf("hello"));
      expect(received.mock.calls).toEqual([[chatOf("hi")], [chatOf("hello")]]);
    });

    it("sends a staged chat once it settles, and a later one doesn't wait for it", async () => {
      const { service, provider } = setup();
      const received = vi.fn();
      service.on(TOKIO_EVENTS.CHAT, received);
      const translated = {
        ...chatOf("hola", "es"),
        comment: {
          ...chatOf("hola", "es").comment,
          translation: { text: "hello", from: "es", to: "en" },
        },
      };
      let settle = (_chat: ChatEvent) => {};
      service.setChatStage((chat) =>
        chat.comment.lang === "es"
          ? new Promise<ChatEvent>((resolve) => (settle = resolve))
          : null,
      );

      provider.chat(chatOf("hola", "es"));
      provider.chat(chatOf("next"));
      expect(received.mock.calls).toEqual([[chatOf("next")]]);

      settle(translated);
      await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
      expect(received).toHaveBeenLastCalledWith(translated);
    });

    it("drops a staged chat whose connection stopped meanwhile", async () => {
      const { service, provider } = setup();
      const received = vi.fn();
      service.on(TOKIO_EVENTS.CHAT, received);
      const staged = Promise.resolve(chatOf("hola", "es"));
      service.setChatStage(() => staged);

      provider.chat(chatOf("hola", "es"), () => false);
      await staged;
      await Promise.resolve();

      expect(received).not.toHaveBeenCalled();
    });
  });

  describe("a LIVE across platforms", () => {
    const room = (
      viewers: number,
      views: number,
      ranks = 0,
    ): RoomUserEvent => ({
      ranks: Array.from({ length: ranks }, (_, i) => ({
        username: `top ${i}`,
        handle: `top${i}`,
        profilePictures: [],
        userId: `${i}`,
        score: 10,
        position: i + 1,
      })),
      viewers,
      views,
    });

    const both = () => {
      const service = new TestService();
      service.setLogFile("connector.log");
      const tiktok = new FakeConnector();
      service.addProvider("Fake", tiktok, true);
      const twitch = new FakeAccountConnector();
      service.add("twitch", twitch);
      const connected = vi.fn();
      const disconnected = vi.fn();
      const rooms = vi.fn();
      const onPlatform = vi.fn();
      service.on(TOKIO_EVENTS.CONNECTED, connected);
      service.on(TOKIO_EVENTS.DISCONNECTED, disconnected);
      service.on(TOKIO_EVENTS.ROOM_USER, rooms);
      service.onPlatform(onPlatform);
      return {
        service,
        tiktok,
        twitch,
        connected,
        disconnected,
        rooms,
        onPlatform,
      };
    };

    it("starts with the first platform up and ends with the last one down", () => {
      const { tiktok, twitch, connected, disconnected, onPlatform } = both();

      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.DISCONNECTED, { reason: "ended" });
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      tiktok.fire(TOKIO_EVENTS.DISCONNECTED, undefined);
      expect(disconnected).not.toHaveBeenCalled();
      twitch.fire(TOKIO_EVENTS.DISCONNECTED, { reason: "lost" });

      expect(connected).toHaveBeenCalledOnce();
      expect(disconnected).toHaveBeenCalledExactlyOnceWith({ reason: "lost" });
      expect(onPlatform.mock.calls).toEqual([
        ["twitch", "up"],
        ["twitch", "ended"],
        ["twitch", "up"],
        ["tiktok", "stopped"],
      ]);
    });

    it("tells no platform's stop while a Disconnect stops them all", async () => {
      const { service, tiktok, twitch, disconnected, onPlatform } = both();
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      onPlatform.mockClear();
      // Each stop arrives later, as the providers' do
      for (const provider of [tiktok, twitch]) {
        provider.disconnect.mockImplementation(async () => {
          setImmediate(() => provider.fire(TOKIO_EVENTS.DISCONNECTED));
        });
      }

      await service.disconnect();
      await new Promise((resolve) => setImmediate(resolve));

      expect(onPlatform).not.toHaveBeenCalled();
      expect(disconnected).toHaveBeenCalledOnce();
      expect(tiktok.disconnect).toHaveBeenCalledOnce();
      expect(twitch.disconnect).toHaveBeenCalledOnce();

      // The next session tells them again
      await service.connect({ tiktok: "streamer" });
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.DISCONNECTED, { reason: "lost" });
      expect(onPlatform).toHaveBeenLastCalledWith("twitch", "lost");
    });

    it("stops one platform alone, told as that platform's stop", async () => {
      const { service, tiktok, twitch, disconnected, onPlatform } = both();
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      onPlatform.mockClear();
      twitch.disconnect.mockImplementation(async () => {
        setImmediate(() => twitch.fire(TOKIO_EVENTS.DISCONNECTED));
      });

      await service.disconnect("twitch");
      await new Promise((resolve) => setImmediate(resolve));

      expect(twitch.disconnect).toHaveBeenCalledOnce();
      expect(tiktok.disconnect).not.toHaveBeenCalled();
      expect(onPlatform).toHaveBeenCalledExactlyOnceWith("twitch", "stopped");
      expect(disconnected).not.toHaveBeenCalled();
    });

    it("merges the platforms' rooms: TikTok's ranks, everyone's viewers", () => {
      const { tiktok, twitch, rooms } = both();
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);

      tiktok.fire(TOKIO_EVENTS.ROOM_USER, room(10, 100, 2));
      // TikTok alone comes out as it was sent
      expect(rooms).toHaveBeenLastCalledWith(room(10, 100, 2));
      twitch.fire(TOKIO_EVENTS.ROOM_USER, room(5, 0));
      expect(rooms).toHaveBeenLastCalledWith(room(15, 100, 2));

      // A platform that goes down leaves the count
      twitch.fire(TOKIO_EVENTS.DISCONNECTED, { reason: "ended" });
      expect(rooms).toHaveBeenLastCalledWith(room(10, 100, 2));
      tiktok.fire(TOKIO_EVENTS.DISCONNECTED, undefined);
      expect(rooms).toHaveBeenCalledTimes(3);
    });

    it("gives each platform's viewers, for as long as it's up", () => {
      const { service, tiktok, twitch } = both();
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      expect(service.viewers()).toEqual({});

      tiktok.fire(TOKIO_EVENTS.ROOM_USER, room(10, 100, 2));
      twitch.fire(TOKIO_EVENTS.ROOM_USER, room(5, 0));
      expect(service.viewers()).toEqual({ tiktok: 10, twitch: 5 });

      twitch.fire(TOKIO_EVENTS.DISCONNECTED, { reason: "ended" });
      expect(service.viewers()).toEqual({ tiktok: 10 });
    });

    it("says how each platform is doing", () => {
      const { service, tiktok, twitch } = both();
      tiktok.isConnected.mockReturnValue(false);
      twitch.isConnected.mockReturnValue(false);
      expect(service.status()).toEqual({});
      expect(service.isConnected()).toBe(false);

      twitch.isConnected.mockReturnValue(true);
      expect(service.status()).toEqual({ twitch: "connecting" });
      expect(service.isConnected()).toBe(true);

      tiktok.isConnected.mockReturnValue(true);
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      twitch.fire(TOKIO_EVENTS.CONNECTED);
      expect(service.status()).toEqual({
        tiktok: "connected",
        twitch: "connected",
      });

      vi.spyOn(tiktok, "isReconnecting").mockReturnValue(true);
      expect(service.status().tiktok).toBe("reconnecting");
      // Only when every platform up is coming back
      expect(service.isReconnecting()).toBe(false);
      vi.spyOn(twitch, "isReconnecting").mockReturnValue(true);
      expect(service.isReconnecting()).toBe(true);
    });

    it("waits for TikTok's LIVE only without a session", () => {
      const { service, tiktok, twitch } = both();
      const waiting = vi.spyOn(tiktok, "isWaiting").mockReturnValue(true);
      twitch.fire(TOKIO_EVENTS.CONNECTED);

      expect(service.status().tiktok).toBe("waiting");
      expect(service.isWaiting()).toBe(false);

      twitch.fire(TOKIO_EVENTS.DISCONNECTED, { reason: "ended" });
      expect(service.isWaiting()).toBe(true);
      waiting.mockReturnValue(false);
      expect(service.isWaiting()).toBe(false);
    });

    it("names the session after the platform that started it", async () => {
      const { service, tiktok, twitch } = both();
      let during = "";
      twitch.connect.mockImplementation(async () => {
        twitch.fire(TOKIO_EVENTS.CONNECTED);
        during = service.username;
        return { success: true };
      });
      tiktok.connect.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        tiktok.fire(TOKIO_EVENTS.CONNECTED);
        return { success: true };
      });

      await service.connect({ tiktok: "streamer", twitch: "mia" });

      expect(during).toBe("mia");
      expect(service.username).toBe("mia");
      expect(service.channel("tiktok")).toBe("streamer");
      expect(service.channel("twitch")).toBe("mia");
    });

    it("connects the platforms at once, and answers with a success", async () => {
      const error = vi.spyOn(Logger, "error");
      const { service, tiktok, twitch } = both();
      const failure = connectFailure("noKey", "Not signed in");
      twitch.connect.mockResolvedValue({ success: false, error: failure });
      const onResult = vi.fn();

      const res = await service.connect(
        { tiktok: "streamer", twitch: "mia" },
        onResult,
      );

      expect(res).toEqual({ success: true });
      expect(tiktok.connect).toHaveBeenCalledWith("streamer");
      expect(onResult).toHaveBeenCalledWith("tiktok", { success: true });
      expect(onResult).toHaveBeenCalledWith("twitch", {
        success: false,
        error: failure,
      });
      expect(error).toHaveBeenCalledWith(
        "<Connector> Unable to connect to mia on Twitch -- Not signed in",
        "connector.log",
        undefined,
      );

      // All failed: the first one
      tiktok.connect.mockResolvedValue({
        success: false,
        error: connectFailure("offline", "Offline"),
      });
      const failed = await service.connect({ tiktok: "streamer", twitch: "" });
      expect(failed.error?.kind).toBe("offline");
    });

    it("joins only the platforms that are down", async () => {
      const { service, tiktok, twitch } = both();
      tiktok.fire(TOKIO_EVENTS.CONNECTED);
      const onResult = vi.fn();

      await service.connect({ tiktok: "other", twitch: "mia" }, onResult);

      expect(tiktok.connect).not.toHaveBeenCalled();
      expect(twitch.connect).toHaveBeenCalledWith("mia");
      expect(onResult).toHaveBeenCalledWith("tiktok", { success: true });
    });

    it("says to sign in to Twitch before connecting to it", async () => {
      const { service } = setup();

      // Twitch's own provider, with no account: no request goes out
      const res = await service.connect({ twitch: "mia" });

      expect(res.success).toBe(false);
      expect(res.error?.kind).toBe("noKey");
    });

    it("gives other platforms its log file and chat stage", () => {
      const service = new TestService();
      service.setLogFile("connector.log");
      const stage = vi.fn(() => null);
      service.setChatStage(stage);
      const twitch = new FakeAccountConnector();
      const setLogFile = vi.spyOn(twitch, "setLogFile");
      const setChatStage = vi.spyOn(twitch, "setChatStage");

      service.add("twitch", twitch);
      service.setLogFile("other.log");

      expect(setLogFile.mock.calls).toEqual([["connector.log"], ["other.log"]]);
      expect(setChatStage).toHaveBeenCalledExactlyOnceWith(stage);
      // Not a TikTok backend
      expect(service.providerNames()).toEqual(["Default"]);
    });
  });

  describe("the Twitch account", () => {
    it("is kept and used by Twitch's provider", async () => {
      const service = new TestService();
      const onAccount = vi.fn(async () => true);
      service.onTwitchAccount(onAccount);
      const twitch = new FakeAccountConnector();
      service.add("twitch", twitch);
      const onCode = vi.fn();
      const { signal } = new AbortController();

      service.setTwitchAccount(account);
      const signedIn = await service.signInTwitch(onCode, signal);
      await service.signOutTwitch();

      expect(twitch.onAccount).toHaveBeenCalledExactlyOnceWith(onAccount);
      expect(twitch.setAccount).toHaveBeenCalledExactlyOnceWith(account);
      expect(twitch.signIn).toHaveBeenCalledExactlyOnceWith(onCode, signal);
      expect(signedIn).toEqual(account);
      expect(twitch.signOut).toHaveBeenCalledOnce();
    });
  });

  it("starts with the default provider", () => {
    const service = new ConnectorService();

    expect(service.providerNames()).toEqual(["Default"]);
    expect(service.isConnected()).toBe(false);
  });
});
