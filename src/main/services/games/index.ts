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

// The wait between two runs of an action, so a burst doesn't flood the game
export const RUN_GAP_MS = 100;

// Runs of one action for one event, filled with its values, waiting their turn
type Batch = {
  edition: MinecraftEdition;
  commands: string[];
  times: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

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
  // Each action's runs still to send, by action id, see _pump
  private _backlogs = new Map<string, Batch[]>();
  // The latest profile's actions, which can stop a backlog
  private _games: Profile["games"] = { actions: [] };
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
   * Runs every enabled action that matches the live event, after the runs
   * each action already has waiting. Resolves once the game answered this
   * event's commands, or they were dropped.
   */
  public async handle<K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
    games: Profile["games"],
  ) {
    this._games = games;
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
        this._queue(
          action,
          this._commands(action.steps, values, action.edition),
          times,
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
      edition,
    );
    return { success: true, data: await this._send(commands) };
  }

  /**
   * Forgets the gift streaks, as their ends may be missed, and the likes
   * counted toward each Like action. Runs already waiting still go out.
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
      return added;
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
      return Math.floor(likes / likes_every);
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

  // One run's commands
  private _commands(
    steps: GameStep[],
    payload: TokioEventMap[AppEvents],
    edition: MinecraftEdition,
  ) {
    const fill = (text: string) =>
      formatAlertMessage(text, payload, commandValue);
    return steps.flatMap((step) => gameCommands(step, fill, edition));
  }

  // All sent at once, in order: the connection queues them
  private _send(commands: string[]) {
    return Promise.all(
      commands.map((command) => this._minecraft.send(command)),
    );
  }

  // Adds the runs to the action's backlog, and starts its pump if it's idle
  private _queue(action: GameAction, commands: string[], times: number) {
    if (commands.length === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const batch = {
        edition: action.edition,
        commands,
        times,
        resolve,
        reject,
      };
      const backlog = this._backlogs.get(action.id);
      if (backlog) backlog.push(batch);
      else void this._pump(action.id, [batch]);
    });
  }

  // Sends one run at a time, RUN_GAP_MS after the last one was answered,
  // until the backlog is empty. Each action has its own, side by side.
  private async _pump(id: string, backlog: Batch[]) {
    this._backlogs.set(id, backlog);
    try {
      for (let first = true; backlog.length > 0; first = false) {
        if (!first) await new Promise((r) => setTimeout(r, RUN_GAP_MS));
        const batch = backlog[0];
        // Stopped when the latest profile removed, disabled or moved the
        // action; runs it accepted keep their commands if only steps changed
        const action = this._games.actions.find((a) => a.id === id);
        if (!action?.enabled || action.edition !== batch.edition) break;
        // Turned off: dropped quietly, as handle skips everything then
        const { state } = this._minecraft.status;
        if (state === "off" || state === "error") break;
        const unreachable = this._unreachable(action.edition);
        if (unreachable) {
          this._onError?.(action, { offline: true, message: unreachable });
          break;
        }
        const failed = (await this._send(batch.commands)).find((r) => !r.ok);
        if (failed) {
          // A game that left or was replaced midway fails the commands it
          // hadn't answered, and drops the rest
          const offline = this._unreachable(action.edition) !== undefined;
          this._onError?.(action, { offline, message: failed.message });
          if (offline) break;
        }
        if (--batch.times === 0) backlog.shift()?.resolve();
      }
      for (const batch of backlog) batch.resolve();
    } catch (error) {
      for (const batch of backlog) batch.reject(error);
    } finally {
      this._backlogs.delete(id);
    }
  }
}
