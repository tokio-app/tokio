import { TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import Logger from "@/logger";
import { describe, expect, it, vi } from "vitest";
import { connectFailure, ConnectorProvider, ConnectorResponse } from "./common";
import { TikTokConnectorService } from "./index";

class FakeConnector extends ConnectorProvider {
  setKey = vi.fn();
  on = vi.fn();
  off = vi.fn();
  connect = vi.fn(async (): Promise<ConnectorResponse> => ({ success: true }));
  disconnect = vi.fn(async () => {});
  isConnected = vi.fn(() => true);
  fetchGifts = vi.fn(async () => ({ success: true, data: [] }));
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
    const info = vi.spyOn(Logger, "info");
    const success = vi.spyOn(Logger, "success");
    const { service, provider } = setup();

    const res = await service.connect("streamer", "session");

    expect(res).toEqual({ success: true });
    expect(provider.connect).toHaveBeenCalledWith("streamer", "session");
    expect(info).toHaveBeenCalledWith(
      "<Connector> Connecting to: streamer",
      "connector.log",
    );
    expect(success).toHaveBeenCalledWith(
      "<Connector> Connected to streamer.",
      "connector.log",
    );
  });

  it("logs and returns a failed connection", async () => {
    const error = vi.spyOn(Logger, "error");
    const { service, provider } = setup();
    const cause = connectFailure("offline", "User is offline");
    provider.connect.mockResolvedValue({ success: false, error: cause });

    const res = await service.connect("streamer");

    expect(res).toEqual({ success: false, error: cause });
    expect(error).toHaveBeenCalledWith(
      "<Connector> Unable to connect to streamer -- User is offline",
      "connector.log",
      cause,
    );
  });

  it("passes everything else to the active provider", async () => {
    const { service, provider } = setup();
    const listener = (_: TokioEventMap[TOKIO_EVENTS.CHAT]) => {};
    const onReconnect = vi.fn();
    const reconnect = vi.spyOn(provider, "onReconnect");

    service.on(TOKIO_EVENTS.CHAT, listener);
    service.off(TOKIO_EVENTS.CHAT, listener);
    service.onReconnect(onReconnect);
    await service.disconnect();

    expect(provider.on).toHaveBeenCalledWith(TOKIO_EVENTS.CHAT, listener);
    expect(provider.off).toHaveBeenCalledWith(TOKIO_EVENTS.CHAT, listener);
    expect(reconnect).toHaveBeenCalledWith(onReconnect);
    expect(provider.disconnect).toHaveBeenCalledOnce();
    expect(service.isConnected()).toBe(true);
    expect(await service.fetchGifts()).toEqual({ success: true, data: [] });
  });

  it("gives its providers its log file", () => {
    const { service, provider } = setup();
    const setLogFile = vi.spyOn(provider, "setLogFile");

    service.setLogFile("other.log");

    expect(setLogFile).toHaveBeenCalledWith("other.log");
  });

  it("starts with the default provider", () => {
    const service = new TikTokConnectorService();

    expect(service.getProviders()).toEqual([
      expect.objectContaining({ name: "Default", active: true }),
    ]);
    expect(service.isConnected()).toBe(false);
  });
});
