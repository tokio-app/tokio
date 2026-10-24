import { GameAction, GameStep } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  GameStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import { MINECRAFT_MOD_DOCS_URL } from "@/common/util";
import { failure, gift, profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList, section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Games } from ".";
import { createAction } from "./helper";

const action = (id: string, patch: Partial<GameAction> = {}): GameAction => ({
  ...createAction("bedrock"),
  id,
  ...patch,
});

const command = (text: string): GameStep => ({
  type: "command",
  command: text,
});

function setup() {
  return renderWithProviders(<Games />, {
    user: { advanceTimers: (ms) => vi.advanceTimersByTime(ms) },
  });
}

async function load(actions: GameAction[] = []) {
  const app = setup();
  await send(
    APP_EVENTS_RESPONSE.GET_PROFILE,
    profileReply((p) => {
      p.games.actions = actions;
    }),
  );
  return app;
}

const status = (minecraft: GameStatus, enabled = minecraft.state !== "off") =>
  send(APP_EVENTS_RESPONSE.GAMES, {
    success: true,
    data: { settings: { minecraft: { enabled } }, status: { minecraft } },
  });

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const saves = () =>
  sent(APP_EVENTS.UPDATE_GAMES_SETTINGS).map(({ settings }) => settings);

// An action's panel, by its Remove button
const panelElements = () =>
  screen
    .queryAllByRole("button", { name: "Remove action" })
    .map((button) => button.closest("li")!);
const panels = () => panelElements().map((panel) => within(panel));

const setupSteps = () => screen.queryByText("Open a world with cheats on.");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Games", () => {
  it("asks main for the games, the profile and the gifts", () => {
    setup();

    expect(sent(APP_EVENTS.GET_GAMES)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_GIFTS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_CUSTOM_GIFTS)).toHaveLength(1);
  });

  it("shows Minecraft once main first answers, and ignores failed replies", async () => {
    setup();
    expect(
      screen.queryByRole("heading", { name: "Minecraft" }),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GAMES, failure());
    expect(
      screen.queryByRole("heading", { name: "Minecraft" }),
    ).not.toBeInTheDocument();

    await status({ state: "waiting" });
    expect(
      section("Minecraft").getByText("Waiting for Minecraft"),
    ).toBeVisible();

    await send(APP_EVENTS_RESPONSE.GAMES, failure());
    expect(
      section("Minecraft").getByText("Waiting for Minecraft"),
    ).toBeVisible();
  });

  it("shows each status main pushes", async () => {
    setup();

    await status({ state: "off" });
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Listen for Minecraft" }),
    ).not.toBeChecked();

    await status({ state: "waiting" });
    expect(screen.getByText("Waiting for Minecraft")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Listen for Minecraft" }),
    ).toBeChecked();

    await status({ state: "connected" });
    expect(screen.getByText("Connected")).toBeInTheDocument();

    await status({ state: "error", error: "Port 37892 is in use." });
    expect(screen.getByText("Port 37892 is in use.")).toBeInTheDocument();
  });

  it("turns Minecraft on and off at once", async () => {
    const { user } = setup();
    await status({ state: "off" });
    const toggle = screen.getByRole("checkbox", {
      name: "Listen for Minecraft",
    });

    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(sent(APP_EVENTS.SET_GAMES_SETTINGS)).toEqual([
      { settings: { minecraft: { enabled: true } } },
      { settings: { minecraft: { enabled: false } } },
    ]);
  });

  it("says which edition connected", async () => {
    setup();

    await status({ state: "connected", edition: "java" });
    expect(screen.getByText("Connected to Java Edition")).toBeInTheDocument();

    await status({ state: "connected", edition: "bedrock" });
    expect(
      screen.getByText("Connected to Bedrock Edition"),
    ).toBeInTheDocument();
  });

  it("shows how each edition connects until a game connects", async () => {
    setup();
    await status({ state: "waiting" });
    await send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, {
      addresses: ["192.168.1.20"],
    });

    const stepsOf = (edition: string) =>
      within(screen.getByRole("heading", { name: edition }).parentElement!)
        .getAllByRole("listitem")
        .map((step) => step.textContent);
    expect(stepsOf("Bedrock Edition")).toEqual([
      "In Settings → General → Network settings, turn on Enable WebSockets.",
      "Open a world with cheats on.",
      "Paste the command in the chat.",
    ]);
    expect(stepsOf("Java Edition")).toEqual([
      "Install Fabric Loader and Fabric API for Minecraft 26.3, then the Tokio mod. See how",
      "Open a world. Cheats can stay off.",
      "Paste the command in the chat.",
    ]);
    expect(screen.getByRole("link", { name: "See how" })).toHaveAttribute(
      "href",
      MINECRAFT_MOD_DOCS_URL,
    );
    expect(
      screen
        .getAllByTitle("Copy the Bedrock command")
        .map((c) => c.textContent),
    ).toEqual(["/connect 192.168.1.20:37892"]);
    expect(
      screen.getAllByTitle("Copy the Java command").map((c) => c.textContent),
    ).toEqual(["/tokio connect 192.168.1.20:37892"]);

    await status({ state: "connected", edition: "java" });
    expect(setupSteps()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Java Edition" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Copy the/)).not.toBeInTheDocument();
  });

  it("falls back to localhost when this PC has no network address", async () => {
    setup();
    await status({ state: "waiting" });
    expect(screen.queryByTitle(/^Copy the/)).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, { addresses: [] });

    expect(screen.getByTitle("Copy the Bedrock command")).toHaveTextContent(
      "/connect localhost:37892",
    );
    expect(screen.getByTitle("Copy the Java command")).toHaveTextContent(
      "/tokio connect localhost:37892",
    );
  });

  it("copies each edition's command of each address", async () => {
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await status({ state: "waiting" });
    await send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, {
      addresses: ["192.168.1.20", "10.0.0.5"],
    });

    for (const copy of screen.getAllByTitle(/^Copy the/))
      await user.click(copy);

    expect(writeText.mock.calls).toEqual([
      ["/connect 192.168.1.20:37892"],
      ["/connect 10.0.0.5:37892"],
      ["/tokio connect 192.168.1.20:37892"],
      ["/tokio connect 10.0.0.5:37892"],
    ]);
  });

  it("says when there are no actions", async () => {
    await load([]);

    expect(
      screen.getByText("No actions yet. Use the add button to create one."),
    ).toBeInTheDocument();
  });

  it("adds and removes actions, and saves them", async () => {
    const { user } = await load([]);

    await user.click(screen.getByRole("button", { name: "Add action" }));
    expect(panels()).toHaveLength(1);
    expect(panels()[0].getByText("Follow")).toBeInTheDocument();
    expect(panels()[0].getByText("Spawn mob")).toBeInTheDocument();
    expect(panels()[0].getByText("Zombie")).toBeInTheDocument();

    await wait(300);
    expect(saves()).toEqual([
      {
        actions: [
          {
            id: expect.any(String),
            enabled: true,
            edition: "bedrock",
            trigger: expect.objectContaining({ type: TOKIO_EVENTS.FOLLOW }),
            likes_every: 100,
            steps: [{ type: "spawn", mob: "zombie", amount: 1, name: "" }],
          },
        ],
      },
    ]);

    await user.click(
      panels()[0].getByRole("button", { name: "Remove action" }),
    );
    await wait(300);
    expect(panels()).toHaveLength(0);
    expect(saves().at(-1)).toEqual({ actions: [] });
  });

  it("adds, changes and removes steps", async () => {
    const { user } = await load([action("a1")]);
    const panel = panels()[0];

    await user.click(panel.getByRole("button", { name: "Add step" }));
    expect(panel.getAllByRole("button", { name: "Remove step" })).toHaveLength(
      2,
    );

    // The second step becomes a command
    await user.click(panel.getAllByText("Spawn mob")[1]);
    await user.click(inList(panelElements()[0], "Command")!);
    await user.type(panel.getByRole("textbox", { name: "Command" }), "say hi");

    await user.click(panel.getAllByRole("button", { name: "Remove step" })[0]);
    await wait(300);

    expect(saves().at(-1)!.actions[0].steps).toEqual([command("say hi")]);
  });

  it("puts variables in the step's text field last focused", async () => {
    const { user } = await load([
      action("a1", {
        steps: [
          { type: "spawn", mob: "zombie", amount: 1, name: "" },
          command("say "),
        ],
      }),
    ]);
    const panel = panels()[0];
    const insert = () =>
      user.click(panel.getByRole("button", { name: "{username}" }));

    // The first text field, before any is focused
    await insert();
    expect(panel.getByRole("textbox", { name: "Name" })).toHaveValue(
      "{username}",
    );

    await user.click(panel.getByRole("textbox", { name: "Command" }));
    await insert();
    expect(panel.getByRole("textbox", { name: "Command" })).toHaveValue(
      "say {username}",
    );
  });

  it("leaves the count out for a gift action on every gift", async () => {
    await load([
      action("a1", {
        trigger: {
          ...createAction("bedrock").trigger,
          type: TOKIO_EVENTS.GIFT,
          every_gift: true,
        },
      }),
    ]);
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, { data: [gift(5655, "Rose")] });

    const panel = panels()[0];
    expect(panel.getByRole("button", { name: "{gift}" })).toBeInTheDocument();
    expect(
      panel.queryByRole("button", { name: "{count}" }),
    ).not.toBeInTheDocument();
  });

  it("filters chat by keyword, joins by viewer, and counts likes", async () => {
    const { trigger } = createAction("bedrock");
    const { user } = await load([
      action("a1", { trigger: { ...trigger, type: TOKIO_EVENTS.CHAT } }),
      action("a2", { trigger: { ...trigger, type: TOKIO_EVENTS.MEMBER_JOIN } }),
      action("a3", { trigger: { ...trigger, type: TOKIO_EVENTS.LIKE } }),
    ]);
    const [chat, join, likes] = panels();

    await user.type(chat.getByPlaceholderText("Any message"), "tnt please");
    await user.type(join.getByPlaceholderText("Anyone"), "@aku");
    const every = likes.getByRole("spinbutton", { name: "Likes per run" });
    expect(every).toHaveValue(100);
    await user.clear(every);
    await user.type(every, "50");

    await wait(300);
    const [keyword, joined, liked] = saves().at(-1)!.actions;
    expect(keyword.trigger.keyword).toBe("tnt please");
    expect(joined.trigger.user).toBe("@aku");
    expect(liked.likes_every).toBe(50);
  });

  it("tests an action and shows what the game answered", async () => {
    const steps = [command("say hi"), command("bad")];
    const { user } = await load([action("a1", { steps }), action("a2")]);
    const [first, second] = panels();

    await user.click(first.getByRole("button", { name: "Test" }));
    expect(sent(APP_EVENTS.TEST_GAME_ACTION)).toEqual([
      { id: "a1", edition: "bedrock", trigger: TOKIO_EVENTS.FOLLOW, steps },
    ]);

    // Another action's reply
    await send(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, {
      success: true,
      id: "a2",
      results: [{ command: "summon zombie ~ ~ ~", ok: true, message: "" }],
    });
    expect(first.queryByText("summon zombie ~ ~ ~")).not.toBeInTheDocument();
    expect(second.queryByText("summon zombie ~ ~ ~")).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, {
      success: true,
      id: "a1",
      results: [
        { command: "say hi", ok: true, message: "[Aku] hi" },
        { command: "bad", ok: false, message: "Syntax error" },
      ],
    });
    expect(first.getByText("1 of 2 commands failed")).toBeInTheDocument();
    expect(first.getByText("[Aku] hi")).toBeInTheDocument();
    expect(first.getByRole("img", { name: "Ran" })).toBeInTheDocument();
    expect(first.getByText("Syntax error")).toBeInTheDocument();
    expect(first.getByRole("img", { name: "Failed" })).toBeInTheDocument();
  });

  it("shows a test's last 25 commands, folded under how many ran", async () => {
    const { user } = await load([action("a1")]);

    await user.click(screen.getByRole("button", { name: "Test" }));
    await send(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, {
      success: true,
      id: "a1",
      results: Array.from({ length: 30 }, (_, i) => ({
        command: `say ${i + 1}`,
        ok: true,
        message: "",
      })),
    });

    expect(screen.getByText("Showing the last 25.")).toBeInTheDocument();
    expect(screen.queryByText("say 5")).not.toBeInTheDocument();
    expect(screen.getByText("say 6")).toBeInTheDocument();
    expect(screen.getByText("say 30")).toBeInTheDocument();

    const summary = screen.getByText("30 commands ran");
    expect(summary.closest("details")).toHaveAttribute("open");
    await user.click(summary);
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("shows why a test failed", async () => {
    const { user } = await load([action("a1")]);

    await user.click(screen.getByRole("button", { name: "Test" }));
    await send(APP_EVENTS_RESPONSE.TEST_GAME_ACTION, {
      ...failure("Turn on Minecraft and connect the game first."),
      id: "a1",
      results: [],
    });

    expect(
      screen.getByText("Turn on Minecraft and connect the game first."),
    ).toBeInTheDocument();
  });

  it("can't test an action without steps", async () => {
    await load([action("a1", { steps: [] })]);

    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });

  it("switches an action's edition, moving its mobs over, and tests it there", async () => {
    const { user } = await load([
      action("a1", {
        steps: [
          { type: "spawn", mob: "evocation_illager", amount: 1, name: "" },
        ],
      }),
    ]);
    const panel = panels()[0];

    await user.click(panel.getByText("Bedrock"));
    await user.click(inList(panelElements()[0], "Java")!);
    await wait(300);

    const saved = saves().at(-1)!.actions[0];
    expect(saved.edition).toBe("java");
    expect(saved.steps).toEqual([
      { type: "spawn", mob: "evoker", amount: 1, name: "" },
    ]);
    expect(panel.getByText("Java")).toBeInTheDocument();

    await user.click(panel.getByRole("button", { name: "Test" }));
    expect(sent(APP_EVENTS.TEST_GAME_ACTION)[0].edition).toBe("java");
  });

  it("lists the mobs and items of the action's edition", async () => {
    const { user } = await load([
      action("b1", { steps: [{ type: "give", item: "diamond", amount: 1 }] }),
      action("j1", {
        edition: "java",
        steps: [
          { type: "spawn", mob: "zombie", amount: 1, name: "" },
          { type: "give", item: "diamond", amount: 1 },
        ],
      }),
    ]);
    const [bedrock, java] = panels();
    const [bedrockPanel, javaPanel] = panelElements();
    const search = (text: string) =>
      user.type(screen.getByPlaceholderText("Search..."), text);

    // Bedrock names the spawn egg after the old mob, Java doesn't
    await user.click(bedrock.getByText("Diamond"));
    await search("Zombie Pigman");
    expect(inList(bedrockPanel, "Zombie Pigman Spawn Egg")).not.toBeNull();
    await user.keyboard("{Escape}");

    await user.click(java.getByText("Diamond"));
    await search("Zombie Pigman");
    expect(inList(javaPanel, "Zombie Pigman Spawn Egg")).toBeNull();
    await user.clear(screen.getByPlaceholderText("Search..."));
    await search("Totem");
    await user.click(inList(javaPanel, "Totem of Undying")!);

    await user.click(java.getByText("Zombie"));
    await search("Creeper");
    await user.click(inList(javaPanel, "Creeper")!);
    await wait(300);

    expect(saves().at(-1)!.actions[1].steps).toEqual([
      { type: "spawn", mob: "creeper", amount: 1, name: "" },
      { type: "give", item: "totem_of_undying", amount: 1 },
    ]);
  });

  it("duplicates an action right after it, with a new id", async () => {
    const steps = [command("say hi")];
    const { user } = await load([
      action("a1", { edition: "java", steps }),
      action("a2"),
    ]);

    await user.click(
      panels()[0].getByRole("button", { name: "Duplicate action" }),
    );
    await wait(300);

    const saved = saves().at(-1)!.actions;
    expect(panels()).toHaveLength(3);
    expect(saved.map((a) => a.id)).toEqual(["a1", expect.any(String), "a2"]);
    expect(saved[1].id).not.toBe("a1");
    expect(saved[1]).toEqual({ ...saved[0], id: saved[1].id });
  });

  it("gives new actions the connected game's edition, else Bedrock", async () => {
    const { user } = await load([]);
    const add = () =>
      user.click(screen.getByRole("button", { name: "Add action" }));

    await status({ state: "connected", edition: "java" });
    await add();
    await status({ state: "waiting" });
    await add();
    await wait(300);

    expect(
      saves()
        .at(-1)!
        .actions.map((a) => a.edition),
    ).toEqual(["java", "bedrock"]);
  });
});
