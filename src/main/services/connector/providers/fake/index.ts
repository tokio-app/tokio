import { Platform, TOKIO_EVENTS } from "@/common/types";
import { createFakeLive } from "@/common/util/samples";
import { ConnectorProvider, ConnectorResponse, fail } from "../../common";

// A connect's wait, the wait between two events, and between two rooms
export const FAKE_TIMES = {
  CONNECT_MS: 1000,
  EVENT_MIN_MS: 600,
  EVENT_MAX_MS: 2000,
  ROOM_MS: 5000,
};

const pause = () =>
  FAKE_TIMES.EVENT_MIN_MS +
  Math.random() * (FAKE_TIMES.EVENT_MAX_MS - FAKE_TIMES.EVENT_MIN_MS);

type Live = {
  channel: string;
  // CONNECTED went out, so a stop sends DISCONNECTED
  up: boolean;
  timer?: NodeJS.Timeout;
  room?: NodeJS.Timeout;
  // Ends the connect's wait early, for a Disconnect
  wake?: () => void;
};

/**
 * A made-up LIVE on one platform, for yarn dev:live (FAKE_LIVE): connecting
 * starts one with no network, and its events go out as a real provider's do.
 */
export class FakeConnector extends ConnectorProvider {
  private _live: Live | null = null;

  constructor(private readonly _platform: Platform) {
    super();
  }

  public async connect(channel: string): Promise<ConnectorResponse> {
    if (this._live) return { success: true };
    const live: Live = { channel, up: false };
    this._live = live;
    const waited = await new Promise<boolean>((resolve) => {
      live.timer = setTimeout(() => resolve(true), FAKE_TIMES.CONNECT_MS);
      live.wake = () => resolve(false);
    });
    if (!waited || this._live !== live) {
      return fail("canceled", "Disconnected while connecting.");
    }

    live.up = true;
    this.emit(TOKIO_EVENTS.CONNECTED);
    const fake = createFakeLive(this._platform);
    const room = () => this.emit(TOKIO_EVENTS.ROOM_USER, fake.room());
    room();
    live.room = setInterval(room, FAKE_TIMES.ROOM_MS);
    const next = () => {
      const event = fake.next();
      if (event.type === TOKIO_EVENTS.CHAT) {
        this.emitChat(event.data, () => this._live === live);
      } else {
        this.emit(event.type, event.data);
      }
      live.timer = setTimeout(next, pause());
    };
    live.timer = setTimeout(next, pause());
    return { success: true };
  }

  public async disconnect(): Promise<void> {
    const live = this._live;
    if (!live) return;
    this._live = null;
    clearTimeout(live.timer);
    clearInterval(live.room);
    live.wake?.();
    // After the events already sent, as the real providers do
    if (live.up) setImmediate(() => this.emit(TOKIO_EVENTS.DISCONNECTED));
  }

  public isConnected(): boolean {
    return this._live !== null;
  }

  public override channel(): string {
    return this._live?.channel ?? "";
  }
}
