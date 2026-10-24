import { GameAction, GamesSettings, GameStep, Profile } from "@/common/schemas";
import {
  AlertTrigger,
  AppEvents,
  CommandResult,
  EMOTE_TRIGGER,
  GamesStatus,
  GameStatus,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { formatAlertMessage, generateTikTokEventSample } from "@/common/util";
import { GiftStreaks } from "@/helper/streaks";
import { giftOf, matchesTrigger } from "@/helper/triggers";
import Logger from "@/logger";
import { Service } from "../shared";
import { commandValue, gameCommands } from "./commands";
import { MinecraftConnection } from "./minecraft";

export interface GamesResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Why an action's commands didn't all run: offline when no game was
 * connected, otherwise the game refused one, with its reply in message.
 */
export type GameError = { offline: boolean; message: string };

// The most times an action on every gift runs for one event
export const MAX_REPEATS = 100;
// The most commands one action sends for one event
export const MAX_COMMANDS = 100;

// What the service uses of the game's connection
type Connection = Pick<
  MinecraftConnection,
  "status" | "onStatus" | "setEnabled" | "send"
>;

const NOT_CONNECTED = "Turn on Minecraft and connect the game first.";

const STATES: Record<GameStatus["state"], string> = {
  off: "is off",
  waiting: "is waiting for the game",
  connected: "is connected",
  error: "can't work",
};

/**
 * Runs the game actions of the active profile when their trigger fires, in
 * the connected game.
 */
export class GamesService extends Service {
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();
  private _last: GameStatus;
  private _onStatus?: (status: GamesStatus) => void;
  private _onError?: (action: GameAction, error: GameError) => void;

  // Opens nothing until configure turns Minecraft on
  constructor(
    private readonly _minecraft: Connection = new MinecraftConnection(),
  ) {
    super();
    this._last = _minecraft.status;
    _minecraft.onStatus((status) => {
      if (
        status.state !== this._last.state ||
        status.error !== this._last.error
      ) {
        const why = status.error ? `: ${status.error}` : ".";
        Logger.info(
          `<Games> Minecraft ${STATES[status.state]}${why}`,
          this._logFile,
        );
      }
      this._last = status;
      this._onStatus?.(this.status());
    });
  }

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  /** Turns the connections on or off. False when one can't listen. */
  public configure(settings: GamesSettings): Promise<boolean> {
    return this._minecraft.setEnabled(settings.minecraft.enabled);
  }

  public status(): GamesStatus {
    return { minecraft: this._minecraft.status };
  }

  // One listener, init.ts
  public onStatus(listener: (status: GamesStatus) => void) {
    this._onStatus = listener;
  }

  // One listener, init.ts, which turns failures into notices
  public onError(listener: (action: GameAction, error: GameError) => void) {
    this._onError = listener;
  }

  /**
   * Runs every enabled action that matches the live event. Resolves once the
   * game answered their commands.
   */
  public async handle<K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
    games: Profile["games"],
  ) {
    // Nothing could reach the game: off, or the port is taken
    const { state } = this._minecraft.status;
    if (state === "off" || state === "error") return;

    // Once per event, whichever actions it runs
    const gift = giftOf(type, payload);
    const { added, total } = gift
      ? this._streaks.add(gift)
      : { added: 0, total: 0 };
    // {count} is the streak's count so far, not TikTok's
    const values = gift
      ? { ...gift, gift: { ...gift.gift, comboCount: total } }
      : payload;

    const runs: Promise<void>[] = [];
    for (const action of games.actions) {
      if (!action.enabled || action.steps.length === 0) continue;
      if (!matchesTrigger(action.trigger, type, payload, added)) continue;

      // An action on every gift runs once for each
      const times =
        action.trigger.type === TOKIO_EVENTS.GIFT && action.trigger.every_gift
          ? Math.min(added, MAX_REPEATS)
          : 1;
      runs.push(this._run(action, this._commands(action.steps, values, times)));
    }
    await Promise.all(runs);
  }

  /** Runs the steps once with a sample of the trigger's event. */
  public async test({
    trigger,
    steps,
  }: {
    trigger: AlertTrigger;
    steps: GameStep[];
  }): Promise<GamesResult<CommandResult[]>> {
    if (this._minecraft.status.state !== "connected") {
      return { success: false, error: NOT_CONNECTED };
    }
    const event = trigger === EMOTE_TRIGGER ? TOKIO_EVENTS.CHAT : trigger;
    const commands = this._commands(
      steps,
      generateTikTokEventSample(event).data,
      1,
    );
    return { success: true, data: await this._send(commands) };
  }

  /** Forgets the gift streaks, as their ends may be missed. */
  public clear() {
    this._streaks.clear();
  }

  // The steps' commands, `times` over, at most MAX_COMMANDS
  private _commands(
    steps: GameStep[],
    payload: TokioEventMap[AppEvents],
    times: number,
  ) {
    const fill = (text: string) =>
      formatAlertMessage(text, payload, commandValue);
    const once = steps.flatMap((step) => gameCommands(step, fill));
    const commands: string[] = [];
    for (let i = 0; i < times && commands.length < MAX_COMMANDS; i++) {
      commands.push(...once);
    }
    return commands.slice(0, MAX_COMMANDS);
  }

  // All sent at once, in order: the connection queues them
  private _send(commands: string[]) {
    return Promise.all(
      commands.map((command) => this._minecraft.send(command)),
    );
  }

  private async _run(action: GameAction, commands: string[]) {
    if (commands.length === 0) return;
    if (this._minecraft.status.state !== "connected") {
      this._onError?.(action, { offline: true, message: NOT_CONNECTED });
      return;
    }
    const failed = (await this._send(commands)).find((result) => !result.ok);
    if (!failed) return;
    // A game that left midway fails the commands it hadn't answered
    const offline = this._minecraft.status.state !== "connected";
    this._onError?.(action, { offline, message: failed.message });
  }
}
