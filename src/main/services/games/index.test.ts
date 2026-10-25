import {
  GameAction,
  GameStep,
  GameStepSchema,
  MinecraftEdition,
  Trigger,
} from "@/common/schemas";
import {
  ChatEvent,
  CommandResult,
  EMOTE_TRIGGER,
  GameStatus,
  GiftEvent,
  TOKIO_EVENTS,
} from "@/common/types";
import Logger from "@/logger";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamesService, RUN_GAP_MS } from "./index";

// Stands in for the game's WebSocket: records the commands, answers each
// with `answer`. Connected, it's the edition's game.
const fakeMinecraft = (
  state: GameStatus["state"] = "connected",
  edition: MinecraftEdition = "bedrock",
) => {
  let listener: ((status: GameStatus) => void) | undefined;
  const fake = {
    status: (state === "connected"
      ? { state, edition }
      : { state }) as GameStatus,
    sent: [] as string[],
    answer: (command: string): CommandResult => ({
      command,
      ok: true,
      message: "",
    }),
    onStatus: (l: (status: GameStatus) => void) => (listener = l),
    setEnabled: vi.fn(async (enabled: boolean) => {
      fake.set({ state: enabled ? "waiting" : "off" });
      return true;
    }),
    send: vi.fn(async (command: string) => {
      fake.sent.push(command);
      return fake.answer(command);
    }),
    close: vi.fn(),
    set: (status: GameStatus) => {
      fake.status = status;
      listener?.(status);
    },
  };
  return fake;
};

const service = (minecraft = fakeMinecraft()) => new GamesService(minecraft);

const trigger = (
  type: Trigger["type"],
  filters: Partial<Trigger> = {},
): Trigger => ({
  type,
  gifts: [],
  every_gift: false,
  emotes: [],
  keyword: "",
  user: "",
  min_coins: 0,
  roles: [],
  ...filters,
});

const say = (text: string): GameStep => ({ type: "command", command: text });

const action = (overrides: Partial<GameAction> = {}): GameAction => ({
  id: "action-1",
  enabled: true,
  edition: "bedrock",
  trigger: trigger(TOKIO_EVENTS.FOLLOW),
  likes_every: 100,
  steps: [say("say Thanks {username}")],
  overlay: { show: true, image: null, event: "", name: "", column: 1 },
  ...overrides,
});

const user = { username: "Viewer", handle: "viewer", profilePictures: [] };

const gift = (comboCount: number, repeatEnd = false): GiftEvent => ({
  user,
  gift: {
    id: "5655",
    coins: 1,
    repeatEnd,
    type: 1,
    name: "Rose",
    comboCount,
    image: "",
  },
});

const chat = (content: string): ChatEvent => ({
  user,
  comment: { content, lang: "en", emotes: [] },
});

describe("GamesService", () => {
  it("opens nothing until configured", async () => {
    const minecraft = fakeMinecraft("off");
    const games = service(minecraft);
    expect(minecraft.setEnabled).not.toHaveBeenCalled();
    expect(await games.configure({ minecraft: { enabled: true } })).toBe(true);
    expect(minecraft.setEnabled).toHaveBeenCalledWith(true);
  });

  it("passes on every status, and logs each change once", () => {
    const info = vi.spyOn(Logger, "info");
    const minecraft = fakeMinecraft("off");
    const games = service(minecraft);
    games.setLogFile("games.log");
    const listener = vi.fn();
    games.onStatus(listener);

    minecraft.set({ state: "waiting" });
    minecraft.set({ state: "waiting" });
    minecraft.set({ state: "connected", edition: "bedrock" });
    minecraft.set({ state: "connected", edition: "java" });
    minecraft.set({ state: "error", error: "Port 37892 is in use." });

    expect(listener.mock.calls).toEqual([
      [{ minecraft: { state: "waiting" } }],
      [{ minecraft: { state: "waiting" } }],
      [{ minecraft: { state: "connected", edition: "bedrock" } }],
      [{ minecraft: { state: "connected", edition: "java" } }],
      [{ minecraft: { state: "error", error: "Port 37892 is in use." } }],
    ]);
    expect(info.mock.calls).toEqual([
      ["<Games> Minecraft is waiting for the game.", "games.log"],
      ["<Games> Minecraft is connected (Bedrock Edition).", "games.log"],
      ["<Games> Minecraft is connected (Java Edition).", "games.log"],
      ["<Games> Minecraft can't work: Port 37892 is in use.", "games.log"],
    ]);
    expect(games.status()).toEqual({
      minecraft: { state: "error", error: "Port 37892 is in use." },
    });
  });

  describe("handle", () => {
    it("runs matching enabled actions' steps, filled and escaped", async () => {
      const minecraft = fakeMinecraft();
      await service(minecraft).handle(
        TOKIO_EVENTS.FOLLOW,
        { user: { ...user, username: 'Bad"} @e' } },
        profileGames({
          follow: action(),
          off: action({ enabled: false }),
          share: action({ trigger: trigger(TOKIO_EVENTS.SHARE) }),
        }),
      );
      expect(minecraft.sent).toEqual(["say Thanks Bad e"]);
    });

    it("skips everything while Minecraft is off or can't listen", async () => {
      for (const state of ["off", "error"] as const) {
        const minecraft = fakeMinecraft(state);
        const games = service(minecraft);
        const onError = vi.fn();
        games.onError(onError);
        await games.handle(
          TOKIO_EVENTS.FOLLOW,
          { user },
          { actions: [action()] },
        );
        expect(minecraft.send).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
      }
    });

    it("reports an action that ran with no game connected", async () => {
      const minecraft = fakeMinecraft("waiting");
      const games = service(minecraft);
      const onError = vi.fn();
      games.onError(onError);
      await games.handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        { actions: [action()] },
      );
      expect(minecraft.send).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(action(), {
        offline: true,
        message: "Turn on Minecraft and connect the game first.",
      });
    });

    it("runs only the actions of the connected game's edition", async () => {
      const minecraft = fakeMinecraft("connected", "java");
      const games = service(minecraft);
      const onError = vi.fn();
      games.onError(onError);
      const bedrock = action({
        id: "bedrock",
        steps: [{ type: "give", item: "diamond", amount: 1 }],
      });
      await games.handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        {
          actions: [
            bedrock,
            action({
              id: "java",
              edition: "java",
              steps: [{ type: "give", item: "diamond", amount: 1 }],
            }),
          ],
        },
      );
      expect(minecraft.sent).toEqual(["give @s minecraft:diamond 1"]);
      expect(onError.mock.calls).toEqual([
        [
          bedrock,
          {
            offline: true,
            message: "Connect Minecraft Bedrock Edition first.",
          },
        ],
      ]);
    });

    it("reports a command the game refused, once per action", async () => {
      const minecraft = fakeMinecraft();
      minecraft.answer = (command) => ({
        command,
        ok: false,
        message: "Syntax error",
      });
      const games = service(minecraft);
      const onError = vi.fn();
      games.onError(onError);
      const twice = action({ steps: [say("a"), say("b")] });
      await games.handle(TOKIO_EVENTS.FOLLOW, { user }, { actions: [twice] });
      expect(minecraft.sent).toEqual(["a", "b"]);
      expect(onError.mock.calls).toEqual([
        [twice, { offline: false, message: "Syntax error" }],
      ]);
    });

    it("tells a game that left midway from a refused command", async () => {
      const minecraft = fakeMinecraft();
      minecraft.send.mockImplementation(async (command) => {
        minecraft.set({ state: "waiting" });
        return { command, ok: false, message: "Minecraft disconnected." };
      });
      const games = service(minecraft);
      const onError = vi.fn();
      games.onError(onError);
      await games.handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        { actions: [action()] },
      );
      expect(onError).toHaveBeenCalledWith(action(), {
        offline: true,
        message: "Minecraft disconnected.",
      });
    });

    it("sends every command without waiting for each answer", async () => {
      const minecraft = fakeMinecraft();
      const answers: ((result: CommandResult) => void)[] = [];
      minecraft.send.mockImplementation((command) => {
        minecraft.sent.push(command);
        return new Promise((resolve) => answers.push(resolve));
      });
      const run = service(minecraft).handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        { actions: [action({ steps: [say("a"), say("b"), say("c")] })] },
      );
      await vi.waitFor(() => expect(minecraft.sent).toEqual(["a", "b", "c"]));
      for (const answer of answers)
        answer({ command: "", ok: true, message: "" });
      await run;
    });

    it("runs gift actions once per streak, or once for each gift", async () => {
      const minecraft = fakeMinecraft();
      const games = service(minecraft);
      const actions = profileGames({
        streak: action({
          trigger: trigger(TOKIO_EVENTS.GIFT),
          steps: [say("end {count}")],
        }),
        every: action({
          trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
          steps: [say("each {count}")],
        }),
      });
      await games.handle(TOKIO_EVENTS.GIFT, gift(1), actions);
      await games.handle(TOKIO_EVENTS.GIFT, gift(3), actions);
      await games.handle(TOKIO_EVENTS.GIFT, gift(3, true), actions);
      expect(minecraft.sent).toEqual(["each 1", "each 3", "each 3", "end 3"]);
    });

    it("counts streaks even when no action matches", async () => {
      const minecraft = fakeMinecraft();
      const games = service(minecraft);
      await games.handle(TOKIO_EVENTS.GIFT, gift(2), profileGames({}));
      await games.handle(
        TOKIO_EVENTS.GIFT,
        gift(3),
        profileGames({
          every: action({
            trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
            steps: [say("{count}")],
          }),
        }),
      );
      expect(minecraft.sent).toEqual(["3"]);
    });

    it("forgets the streaks on clear", async () => {
      const minecraft = fakeMinecraft();
      const games = service(minecraft);
      const actions = profileGames({
        every: action({
          trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
          steps: [say("{count}")],
        }),
      });
      await games.handle(TOKIO_EVENTS.GIFT, gift(2), actions);
      games.clear();
      await games.handle(TOKIO_EVENTS.GIFT, gift(3), actions);
      expect(minecraft.sent).toEqual(["2", "2", "3", "3", "3"]);
    });

    describe("backlogs", () => {
      afterEach(() => vi.useRealTimers());

      const everyGift = (steps = [say("each {count}")]) =>
        action({
          id: "every",
          trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
          steps,
        });

      it("serves every gift, one run every RUN_GAP_MS", async () => {
        vi.useFakeTimers();
        const minecraft = fakeMinecraft();
        const at: number[] = [];
        minecraft.send.mockImplementation(async (command) => {
          minecraft.sent.push(command);
          at.push(Date.now());
          return { command, ok: true, message: "" };
        });
        const actions = { actions: [everyGift([say("a"), say("b")])] };
        const run = service(minecraft).handle(
          TOKIO_EVENTS.GIFT,
          gift(300),
          actions,
        );

        await vi.advanceTimersByTimeAsync(0);
        expect(minecraft.sent).toEqual(["a", "b"]);
        await vi.advanceTimersByTimeAsync(RUN_GAP_MS - 1);
        expect(minecraft.sent).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(minecraft.sent).toHaveLength(4);
        await vi.runAllTimersAsync();
        await run;

        expect(minecraft.sent).toHaveLength(600);
        const runs = at.filter((_, i) => i % 2 === 0);
        expect(runs.slice(1).map((t, i) => t - runs[i])).toEqual(
          Array(299).fill(RUN_GAP_MS),
        );
      });

      it("runs a Like action for every likes_every likes, however many", async () => {
        vi.useFakeTimers();
        const minecraft = fakeMinecraft();
        const run = service(minecraft).handle(
          TOKIO_EVENTS.LIKE,
          { user, likeCount: 250, totalLikes: 0 },
          {
            actions: [
              action({
                trigger: trigger(TOKIO_EVENTS.LIKE),
                likes_every: 1,
                steps: [say("like")],
              }),
            ],
          },
        );
        await vi.runAllTimersAsync();
        await run;
        expect(minecraft.sent).toHaveLength(250);
      });

      it("runs other actions at once while one has a backlog", async () => {
        vi.useFakeTimers();
        const minecraft = fakeMinecraft();
        const games = service(minecraft);
        const actions = profileGames({
          every: everyGift(),
          follow: action({ steps: [say("follow")] }),
        });
        const gifts = games.handle(TOKIO_EVENTS.GIFT, gift(300), actions);
        await vi.advanceTimersByTimeAsync(RUN_GAP_MS);
        await games.handle(TOKIO_EVENTS.FOLLOW, { user }, actions);
        expect(minecraft.sent).toEqual(["each 300", "each 300", "follow"]);
        await vi.runAllTimersAsync();
        await gifts;
        expect(minecraft.sent).toHaveLength(301);
      });

      it("serves an action's events in order", async () => {
        vi.useFakeTimers();
        const minecraft = fakeMinecraft();
        const games = service(minecraft);
        const actions = { actions: [everyGift()] };
        const runs = [
          games.handle(TOKIO_EVENTS.GIFT, gift(2), actions),
          games.handle(TOKIO_EVENTS.GIFT, gift(4), actions),
        ];
        await vi.runAllTimersAsync();
        await Promise.all(runs);
        expect(minecraft.sent).toEqual([
          "each 2",
          "each 2",
          "each 4",
          "each 4",
        ]);
      });

      it("stops when a later profile disables, removes or moves the action", async () => {
        vi.useFakeTimers();
        for (const later of [
          { ...everyGift(), enabled: false },
          undefined,
          { ...everyGift(), edition: "java" as const },
        ]) {
          const minecraft = fakeMinecraft();
          const games = service(minecraft);
          const run = games.handle(TOKIO_EVENTS.GIFT, gift(300), {
            actions: [everyGift()],
          });
          await vi.advanceTimersByTimeAsync(RUN_GAP_MS);
          await games.handle(
            TOKIO_EVENTS.FOLLOW,
            { user },
            { actions: later ? [later] : [] },
          );
          await vi.runAllTimersAsync();
          await run;
          expect(minecraft.sent).toEqual(["each 300", "each 300"]);
        }
      });

      it("drops the backlog when the game leaves, reporting it once", async () => {
        vi.useFakeTimers();
        const minecraft = fakeMinecraft();
        const games = service(minecraft);
        const onError = vi.fn();
        games.onError(onError);
        const every = everyGift();
        const run = games.handle(TOKIO_EVENTS.GIFT, gift(300), {
          actions: [every],
        });
        await vi.advanceTimersByTimeAsync(RUN_GAP_MS);
        minecraft.set({ state: "waiting" });
        await vi.runAllTimersAsync();
        await run;
        expect(minecraft.sent).toHaveLength(2);
        expect(onError.mock.calls).toEqual([
          [
            every,
            {
              offline: true,
              message: "Turn on Minecraft and connect the game first.",
            },
          ],
        ]);
      });

      it("keeps serving the backlogs on clear", async () => {
        vi.useFakeTimers();
        const minecraft = fakeMinecraft();
        const games = service(minecraft);
        const run = games.handle(TOKIO_EVENTS.GIFT, gift(5), {
          actions: [everyGift()],
        });
        games.clear();
        await vi.runAllTimersAsync();
        await run;
        expect(minecraft.sent).toHaveLength(5);
      });
    });

    it("runs like actions once every so many likes, keeping the rest", async () => {
      const minecraft = fakeMinecraft();
      const games = service(minecraft);
      const actions = profileGames({
        likes: action({
          trigger: trigger(TOKIO_EVENTS.LIKE),
          likes_every: 100,
          steps: [say("likes")],
        }),
      });
      const likes = (likeCount: number) =>
        games.handle(
          TOKIO_EVENTS.LIKE,
          { user, likeCount, totalLikes: 0 },
          actions,
        );

      await likes(60);
      expect(minecraft.sent).toEqual([]);
      await likes(60);
      expect(minecraft.sent).toEqual(["likes"]);
      // 20 left over, then 210 likes: two runs, 10 toward the next
      await likes(190);
      expect(minecraft.sent).toHaveLength(3);
      await likes(89);
      expect(minecraft.sent).toHaveLength(3);
      games.clear();
      await likes(99);
      expect(minecraft.sent).toHaveLength(3);
    });

    it("matches chat keywords and emotes", async () => {
      const minecraft = fakeMinecraft();
      const actions = profileGames({
        keyword: action({
          trigger: trigger(TOKIO_EVENTS.CHAT, { keyword: "tnt" }),
          steps: [say("{comment}")],
        }),
        emote: action({
          trigger: trigger(EMOTE_TRIGGER),
          steps: [say("emote")],
        }),
      });
      const games = service(minecraft);
      await games.handle(TOKIO_EVENTS.CHAT, chat("hello"), actions);
      await games.handle(TOKIO_EVENTS.CHAT, chat("more tnt"), actions);
      expect(minecraft.sent).toEqual(["more tnt"]);
    });
  });

  describe("test", () => {
    it("runs the steps once with a sample of the event", async () => {
      const minecraft = fakeMinecraft();
      const res = await service(minecraft).test({
        edition: "bedrock",
        trigger: EMOTE_TRIGGER,
        steps: [say("say {comment}"), { type: "weather", weather: "rain" }],
      });
      expect(res.success).toBe(true);
      expect(minecraft.sent).toHaveLength(2);
      expect(minecraft.sent[0]).toMatch(/^say \S/);
      expect(res.data?.map((r) => r.command)).toEqual(minecraft.sent);
    });

    it("fails with no game connected", async () => {
      const minecraft = fakeMinecraft("waiting");
      expect(
        await service(minecraft).test({
          edition: "bedrock",
          trigger: TOKIO_EVENTS.FOLLOW,
          steps: [say("say hi")],
        }),
      ).toEqual({
        success: false,
        error: "Turn on Minecraft and connect the game first.",
      });
      expect(minecraft.send).not.toHaveBeenCalled();
    });

    it("fails with the other edition connected", async () => {
      const minecraft = fakeMinecraft("connected", "bedrock");
      expect(
        await service(minecraft).test({
          edition: "java",
          trigger: TOKIO_EVENTS.FOLLOW,
          steps: [say("say hi")],
        }),
      ).toEqual({
        success: false,
        error: "Connect Minecraft Java Edition first.",
      });
      expect(minecraft.send).not.toHaveBeenCalled();
    });

    it("runs Java Edition's commands in Java", async () => {
      const minecraft = fakeMinecraft("connected", "java");
      const res = await service(minecraft).test({
        edition: "java",
        trigger: TOKIO_EVENTS.FOLLOW,
        steps: [{ type: "spawn", mob: "pig", amount: 1, name: "" }],
      });
      expect(res.success).toBe(true);
      expect(minecraft.sent).toEqual(["summon minecraft:pig ~ ~ ~"]);
    });

    it("stops a launch at the top, once its push is over", async () => {
      vi.useFakeTimers();
      const minecraft = fakeMinecraft();
      const done = service(minecraft).test({
        edition: "bedrock",
        trigger: TOKIO_EVENTS.FOLLOW,
        steps: [GameStepSchema.parse({ type: "hazard", hazard: "launch" })],
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(minecraft.sent).toEqual([
        expect.stringMatching(/^effect @p levitation 1 \d+$/),
      ]);
      await vi.advanceTimersByTimeAsync(1);
      expect(minecraft.sent.at(-1)).toBe("teleport @p ~ ~ ~");
      // The wait isn't a command, so it has no result
      expect((await done).data).toHaveLength(2);
      vi.useRealTimers();
    });

    it("lights no row on the overlay", async () => {
      const games = service();
      const onRun = vi.fn();
      games.onRun(onRun);
      await games.test({
        edition: "bedrock",
        trigger: TOKIO_EVENTS.FOLLOW,
        steps: [say("say hi")],
      });
      expect(onRun).not.toHaveBeenCalled();
    });
  });

  describe("onRun", () => {
    afterEach(() => vi.useRealTimers());

    it("tells each run as it goes out, every gift's too", async () => {
      vi.useFakeTimers();
      const minecraft = fakeMinecraft();
      const games = service(minecraft);
      const sentBefore: number[] = [];
      const onRun = vi.fn((_action: GameAction) => {
        sentBefore.push(minecraft.sent.length);
      });
      games.onRun(onRun);
      const every = action({
        trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
        steps: [say("a"), say("b")],
      });

      const run = games.handle(TOKIO_EVENTS.GIFT, gift(3), {
        actions: [every],
      });
      await vi.runAllTimersAsync();
      await run;

      expect(onRun.mock.calls).toEqual([[every], [every], [every]]);
      // Right before each run's commands
      expect(sentBefore).toEqual([0, 2, 4]);
    });

    it("tells no run that's dropped while the game is offline", async () => {
      const games = service(fakeMinecraft("waiting"));
      const onRun = vi.fn();
      games.onRun(onRun);
      await games.handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        { actions: [action()] },
      );
      expect(onRun).not.toHaveBeenCalled();
    });
  });

  describe("pictures", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const picturesIn = async (games: GamesService) => {
      const folder = join(dir, "games", "minecraft");
      await mkdir(folder, { recursive: true });
      games.setPicturesFolder(folder);
      return folder;
    };

    it("imports an image into the pictures folder, named by its content", async () => {
      const games = service();
      const folder = await picturesIn(games);
      await writeFile(join(dir, "TNT.webp"), "tnt");

      const res = await games.importPicture(join(dir, "TNT.webp"));

      expect(res).toEqual({
        success: true,
        data: {
          name: "TNT",
          file: expect.stringMatching(/^[0-9a-f]{32}\.webp$/),
        },
      });
      expect(await readdir(folder)).toEqual([res.data?.file]);
    });

    it("refuses anything but an image, logging why", async () => {
      const error = vi.spyOn(Logger, "error").mockImplementation(() => {});
      const games = service();
      games.setLogFile("games.log");
      const folder = await picturesIn(games);
      await writeFile(join(dir, "clip.mp4"), "clip");

      const res = await games.importPicture(join(dir, "clip.mp4"));

      expect(res).toEqual({ success: false, error: "Unsupported format: mp4" });
      expect(error).toHaveBeenCalledWith(
        "<Games> Unable to import picture -- Unsupported format: mp4",
        "games.log",
        expect.any(Error),
      );
      expect(await readdir(folder)).toEqual([]);
    });

    it("deletes a picture only inside its folder", async () => {
      vi.spyOn(Logger, "error").mockImplementation(() => {});
      const games = service();
      const folder = await picturesIn(games);
      await writeFile(join(folder, "tnt.png"), "tnt");
      await writeFile(join(dir, "games", "keep.png"), "keep");

      expect(await games.deletePicture("tnt.png")).toEqual({ success: true });
      expect((await games.deletePicture("../keep.png")).success).toBe(false);
      expect(await readdir(folder)).toEqual([]);
      expect(await readdir(join(dir, "games"))).toContain("keep.png");
    });
  });
});

// The profile's games with these actions, each named by its id
function profileGames(actions: Record<string, GameAction>) {
  return {
    actions: Object.entries(actions).map(([id, a]) => ({ ...a, id })),
  };
}
