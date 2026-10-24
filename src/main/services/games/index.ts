import {
  GameAction,
  GamesSettings,
  GameStep,
  MinecraftEdition,
  Profile,
} from "@/common/schemas";
import {
  AlertTrigger,
  AppEvents,
  CommandResult,
  EMOTE_TRIGGER,
  GamesStatus,
  GameStatus,
  MINECRAFT_EDITION_NAMES,
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
 * Why an action's commands didn't all run: offline when no game of the
 * action's edition was connected, otherwise the game refused one, with its
 * reply in message.
 */
export type GameError = { offline: boolean; message: string };

// The most times an action on every gift or on likes runs for one event
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
 * the connected game when it's the action's edition.
 */
export class GamesService extends Service {
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();
  // Likes toward each Like action's next run, by action id
  private _likes = new Map<string, number>();
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
        status.error !== this._last.error ||
        status.edition !== this._last.edition
      ) {
        const why = status.error
          ? `: ${status.error}`
          : status.edition
            ? ` (${MINECRAFT_EDITION_NAMES[status.edition]}).`
            : ".";
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

      const times = this._times(action, payload, added);
      if (times === 0) continue;
      runs.push(
        this._run(
          action,
          this._commands(action.steps, values, times, action.edition),
        ),
      );
    }
    await Promise.all(runs);
  }

  /** Runs the steps once with a sample of the trigger's event. */
  public async test({
    edition,
    trigger,
    steps,
  }: {
    edition: MinecraftEdition;
    trigger: AlertTrigger;
    steps: GameStep[];
  }): Promise<GamesResult<CommandResult[]>> {
    const unreachable = this._unreachable(edition);
    if (unreachable) return { success: false, error: unreachable };
    const event = trigger === EMOTE_TRIGGER ? TOKIO_EVENTS.CHAT : trigger;
    const commands = this._commands(
      steps,
      generateTikTokEventSample(event).data,
      1,
      edition,
    );
    return { success: true, data: await this._send(commands) };
  }

  /**
   * Forgets the gift streaks, as their ends may be missed, and the likes
   * counted toward each Like action.
   */
  public clear() {
    this._streaks.clear();
    this._likes.clear();
  }

  // How many times a matching action runs for the event: once for each gift
  // on every gift, once for every likes_every likes on Like (the rest count
  // toward its next run), otherwise once
  private _times(
    action: GameAction,
    payload: TokioEventMap[AppEvents],
    added: number,
  ) {
    const { trigger, likes_every } = action;
    if (trigger.type === TOKIO_EVENTS.GIFT && trigger.every_gift) {
      return Math.min(added, MAX_REPEATS);
    }
    if (
      trigger.type === TOKIO_EVENTS.LIKE &&
      typeof payload === "object" &&
      payload !== null &&
      "likeCount" in payload
    ) {
      const likes =
        (this._likes.get(action.id) ?? 0) + Math.max(0, payload.likeCount);
      this._likes.set(action.id, likes % likes_every);
      return Math.min(Math.floor(likes / likes_every), MAX_REPEATS);
    }
    return 1;
  }

  // Why the edition's commands can't run: no game, or the other edition's
  private _unreachable(edition: MinecraftEdition): string | undefined {
    const status = this._minecraft.status;
    if (status.state !== "connected") return NOT_CONNECTED;
    if (status.edition !== edition) {
      return `Connect Minecraft ${MINECRAFT_EDITION_NAMES[edition]} first.`;
    }
    return undefined;
  }

  // The steps' commands, `times` over, at most MAX_COMMANDS
  private _commands(
    steps: GameStep[],
    payload: TokioEventMap[AppEvents],
    times: number,
    edition: MinecraftEdition,
  ) {
    const fill = (text: string) =>
      formatAlertMessage(text, payload, commandValue);
    const once = steps.flatMap((step) => gameCommands(step, fill, edition));
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
    const unreachable = this._unreachable(action.edition);
    if (unreachable) {
      this._onError?.(action, { offline: true, message: unreachable });
      return;
    }
    const failed = (await this._send(commands)).find((result) => !result.ok);
    if (!failed) return;
    // A game that left or was replaced midway fails the commands it hadn't
    // answered
    const offline = this._unreachable(action.edition) !== undefined;
    this._onError?.(action, { offline, message: failed.message });
  }
}
