import { TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import { generateTikTokEventSample } from "@/common/util";
import Logger from "@/logger";
import { describe, expect, it, vi } from "vitest";
import {
  connectFailure,
  ConnectorProvider,
  ConnectorResponse,
  GiftResponse,
} from "./common";
import { TikTokConnectorService } from "./index";

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
}

const setup = () => {
  const service = new TikTokConnectorService();
  service.setLogFile("connector.log");
  const provider = new FakeConnector();
  service.addProvider("Fake", provider, true);
  return { service, provider };
};

describe("TikTokConnectorService", () => {
  it("connects through the active provider and logs it", async () => {
    const debug = vi.spyOn(Logger, "debug");
    const info = vi.spyOn(Logger, "info");
    const { service, provider } = setup();

    const res = await service.connect("streamer");

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
    await service.connect("streamer");
    await service.connect("other");

    expect(during).toBe("other");
    expect(service.username).toBe("other");
  });

  it("logs and returns a failed connection, in one line for a known kind", async () => {
    const error = vi.spyOn(Logger, "error");
    const { service, provider } = setup();
    const cause = connectFailure("offline", "User is offline");
    provider.connect.mockResolvedValue({ success: false, error: cause });

    const res = await service.connect("streamer");

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

    await service.connect("streamer");

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Something broke"),
      "connector.log",
      cause,
    );
  });

  it("passes everything else to the active provider", async () => {
    const { service, provider } = setup();
    const listener = (_: TokioEventMap[TOKIO_EVENTS.CHAT]) => {};
    const onReconnect = vi.fn();
    const reconnect = vi.spyOn(provider, "onReconnect");
    const on = vi.spyOn(provider, "on");
    const off = vi.spyOn(provider, "off");

    service.on(TOKIO_EVENTS.CHAT, listener);
    service.off(TOKIO_EVENTS.CHAT, listener);
    service.onReconnect(onReconnect);
    await service.disconnect();

    expect(on).toHaveBeenCalledWith(TOKIO_EVENTS.CHAT, listener);
    expect(off).toHaveBeenCalledWith(TOKIO_EVENTS.CHAT, listener);
    expect(reconnect).toHaveBeenCalledWith(onReconnect);
    expect(provider.disconnect).toHaveBeenCalledOnce();
    expect(service.isConnected()).toBe(true);
    expect(await service.fetchGifts()).toEqual({ success: true, data: [] });
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

  it("starts with the default provider", () => {
    const service = new TikTokConnectorService();

    expect(service.providerNames()).toEqual(["Default"]);
    expect(service.isConnected()).toBe(false);
  });
});
