import { GameAction, GameStep } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  GameStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import { defaultProfile, MINECRAFT_MOD_DOCS_URL } from "@/common/util";
import {
  failure,
  gift,
  mediaFile,
  profileReply,
  settingsReply,
} from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList, section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Games } from ".";
import styles from "./games.module.css";
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
    expect(
      screen.queryByTitle(/^Copy the .* command$/),
    ).not.toBeInTheDocument();
  });

  it("falls back to localhost when this PC has no network address", async () => {
    setup();
    await status({ state: "waiting" });
    expect(
      screen.queryByTitle(/^Copy the .* command$/),
    ).not.toBeInTheDocument();

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

    for (const copy of screen.getAllByTitle(/^Copy the .* command$/))
      await user.click(copy);

    expect(writeText.mock.calls).toEqual([
      ["/connect 192.168.1.20:37892"],
      ["/connect 10.0.0.5:37892"],
      ["/tokio connect 192.168.1.20:37892"],
      ["/tokio connect 10.0.0.5:37892"],
    ]);
  });

  it("runs on every event but the joins, envelopes, Super Fan Boxes and song changes", async () => {
    const { user } = await load([action("a1")]);

    await user.click(panels()[0].getByText("Follow"));

    for (const left of [
      "Super Fan Join",
      "Member Join",
      "Envelope",
      "Super Fan Box",
      "Music Change",
    ]) {
      expect(inList(panelElements()[0], left)).toBeNull();
    }
    for (const kept of [
      "Chat",
      "Emote",
      "Share",
      "Gift",
      "Like",
      "Super Fan",
    ]) {
      expect(inList(panelElements()[0], kept)).not.toBeNull();
    }
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
            overlay: {
              show: true,
              image: null,
              event: "",
              name: "",
              column: 1,
            },
          },
        ],
        overlay: defaultProfile.games.overlay,
      },
    ]);

    await user.click(
      panels()[0].getByRole("button", { name: "Remove action" }),
    );
    await wait(300);
    expect(panels()).toHaveLength(0);
    expect(saves().at(-1)).toEqual({
      actions: [],
      overlay: defaultProfile.games.overlay,
    });
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

  it("picks a hazard and shows only the fields it takes", async () => {
    const { user } = await load([action("a1")]);
    const panel = panels()[0];
    const field = (name: string) => panel.queryByRole("spinbutton", { name });

    await user.click(panel.getByText("Spawn mob"));
    await user.click(inList(panelElements()[0], "Hazard")!);
    expect(panel.getByText("Falling TNT")).toBeInTheDocument();
    expect(field("Amount")).toBeNull();
    expect(field("Fuse in seconds")).toHaveValue(4);
    // A Bedrock action has only two fuses
    expect(panel.getByText(/4 s in Bedrock/)).toBeInTheDocument();

    await user.click(panel.getByText("Falling TNT"));
    await user.click(inList(panelElements()[0], "Lightning bolt")!);
    expect(field("Amount")).toBeVisible();
    expect(field("Fuse in seconds")).toBeNull();

    await user.click(panel.getByText("Lightning bolt"));
    await user.click(inList(panelElements()[0], "Launch into the sky")!);
    expect(field("Amount")).toBeNull();
    await user.clear(field("Height in blocks")!);
    await user.type(field("Height in blocks")!, "80");
    await user.clear(field("Seconds")!);
    await user.type(field("Seconds")!, "2");

    await user.click(panel.getByText("Launch into the sky"));
    await user.click(inList(panelElements()[0], "Lights out")!);
    expect(field("Height in blocks")).toBeNull();
    await user.clear(field("Duration in seconds")!);
    await user.type(field("Duration in seconds")!, "30");

    await user.click(panel.getByText("Lights out"));
    await user.click(inList(panelElements()[0], "Random teleport")!);
    expect(field("Distance in blocks")).toHaveValue(1000);
    await wait(300);

    expect(saves().at(-1)!.actions[0].steps).toEqual([
      {
        type: "hazard",
        hazard: "random_teleport",
        amount: 1,
        fuse: 4,
        height: 80,
        seconds: 2,
        duration: 30,
        distance: 1000,
      },
    ]);
  });

  it("launches up to the 300 blocks the schema takes", async () => {
    const { user } = await load([action("a1")]);
    const panel = panels()[0];
    const height = () =>
      panel.getByRole("spinbutton", { name: "Height in blocks" });

    await user.click(panel.getByText("Spawn mob"));
    await user.click(inList(panelElements()[0], "Hazard")!);
    await user.click(panel.getByText("Falling TNT"));
    await user.click(inList(panelElements()[0], "Launch into the sky")!);
    await user.clear(height());
    await user.type(height(), "300");
    await wait(300);

    expect(saves().at(-1)!.actions[0].steps[0]).toMatchObject({ height: 300 });
  });

  it("picks a help, with a duration only for effects", async () => {
    const { user } = await load([action("a1")]);
    const panel = panels()[0];
    const duration = () =>
      panel.queryByRole("spinbutton", { name: "Duration in seconds" });

    await user.click(panel.getByText("Spawn mob"));
    await user.click(inList(panelElements()[0], "Help")!);
    expect(panel.getByText("Netherite armor")).toBeInTheDocument();
    expect(duration()).toBeNull();

    await user.click(panel.getByText("Netherite armor"));
    await user.click(inList(panelElements()[0], "Regeneration")!);
    await user.clear(duration()!);
    await user.type(duration()!, "90");
    await wait(300);

    expect(saves().at(-1)!.actions[0].steps).toEqual([
      { type: "help", help: "regeneration", duration: 90 },
    ]);
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

describe("Games overlay", () => {
  const TNT = mediaFile("TNT");
  const CREEPER = mediaFile("Creeper");
  const { trigger, overlay } = createAction("bedrock");
  const giftAction = (id: string, patch: Partial<GameAction> = {}) =>
    action(id, {
      trigger: { ...trigger, type: TOKIO_EVENTS.GIFT, gifts: [5655] },
      ...patch,
    });
  const likeAction = (id: string, patch: Partial<GameAction> = {}) =>
    action(id, { trigger: { ...trigger, type: TOKIO_EVENTS.LIKE }, ...patch });
  const chatAction = (id: string, patch: Partial<GameAction> = {}) =>
    action(id, {
      trigger: { ...trigger, type: TOKIO_EVENTS.CHAT, keyword: "tnt" },
      ...patch,
    });
  const rose = () =>
    send(APP_EVENTS_RESPONSE.GET_GIFTS, { data: [gift(5655, "Rose")] });

  // The builder's rows, one per action
  const recipeElements = () =>
    within(
      screen.getByRole("list", { name: "Actions on the overlay" }),
    ).getAllByRole("listitem");
  const recipes = () => recipeElements().map((li) => within(li));
  const savedOverlays = () =>
    saves()
      .at(-1)!
      .actions.map((a) => a.overlay);

  // The preview's rows
  const preview = () => screen.queryByRole("list", { name: "Overlay preview" });
  const previewRows = () => [...preview()!.querySelectorAll(".games-row")];
  const previewTexts = () =>
    previewRows().map((li) =>
      [...li.querySelectorAll(".games-text")].map((t) => t.textContent),
    );
  const litRows = () =>
    previewRows()
      .filter((li) => li.classList.contains("games-lit"))
      .map((li) => li.querySelector(".games-name")?.textContent);
  const testButton = () =>
    screen.getByRole("button", { name: "Light up the next row" });

  it("says when there are no actions, and has nothing to test", async () => {
    await load([]);

    expect(
      section("Overlay").getByText("Add an action to put it on the overlay."),
    ).toBeInTheDocument();
    expect(
      section("Overlay").getByText(
        "Pick a picture or name an action to show it here.",
      ),
    ).toBeInTheDocument();
    expect(testButton()).toBeDisabled();
  });

  it("gives the overlay's URL to copy", async () => {
    await load([]);

    expect(screen.getByTitle("Copy the overlay's URL")).toHaveTextContent(
      /^http:\/\/tokio-app\.local:37891\/games\/minecraft\/$/,
    );
  });

  it("splits the overlay into columns, each with its URL and its preview", async () => {
    const { user } = await load([
      giftAction("a1", { overlay: { ...overlay, name: "TNT" } }),
      likeAction("a2", { overlay: { ...overlay, name: "Creeper" } }),
    ]);
    await rose();

    await user.click(
      within(screen.getByRole("group", { name: "Columns" })).getByRole(
        "radio",
        { name: "2" },
      ),
    );
    // The second action goes in the second column
    await user.click(recipes()[1].getByRole("combobox", { name: "Column" }));
    await user.click(inList(recipeElements()[1], "Column 2")!);
    await wait(300);

    expect(saves().at(-1)!.overlay.columns).toBe(2);
    expect(savedOverlays().map((o) => o.column)).toEqual([1, 2]);
    expect(screen.queryByTitle("Copy the overlay's URL")).toBeNull();
    for (const column of [1, 2]) {
      expect(
        screen.getByTitle(`Copy column ${column}'s URL`),
      ).toHaveTextContent(
        `http://tokio-app.local:37891/games/minecraft/${column}/`,
      );
    }
    const names = (column: number) =>
      [
        ...screen
          .getByRole("list", {
            name: `Column ${column} of the overlay preview`,
          })
          .querySelectorAll(".games-name"),
      ].map((name) => name.textContent);
    expect(names(1)).toEqual(["TNT"]);
    expect(names(2)).toEqual(["Creeper"]);
  });

  it("lists a row per action: the event's pictures or text, then its picture", async () => {
    await load([
      giftAction("a1"),
      likeAction("a2"),
      action("a3", {
        enabled: false,
        overlay: { ...overlay, image: TNT, name: "TNT" },
      }),
      chatAction("a4"),
      action("a5", { trigger: { ...trigger, type: TOKIO_EVENTS.SUPER_FAN } }),
      giftAction("a6", {
        trigger: { ...trigger, type: TOKIO_EVENTS.GIFT, gifts: [] },
      }),
    ]);
    await rose();

    const [gifted, liked, followed, chatted, superFan, anyGift] = recipes();
    const [giftedRow] = recipeElements();
    // A gift shows only its picture, named for screen readers
    const roseGift = gifted.getByRole("img", { name: "Rose" });
    expect(
      [...roseGift.querySelectorAll("img")].map((img) =>
        img.getAttribute("src"),
      ),
    ).toEqual(["https://example.com/rose.png"]);
    expect(gifted.queryByRole("textbox", { name: "Event text" })).toBeNull();
    // Likes, follows, chat and Super Fans get Tokio's own pictures, the
    // likes counted
    const heart = liked.getByRole("img", { name: "100 likes" });
    expect(heart.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/svg\+xml,/,
    );
    expect(heart).toHaveTextContent("100");
    expect(liked.queryByRole("textbox", { name: "Event text" })).toBeNull();
    expect(followed.getByRole("img", { name: "Follow" })).toBeInTheDocument();
    expect(
      superFan.getByRole("img", { name: "Super Fan" }),
    ).toBeInTheDocument();
    expect(superFan.queryByRole("textbox", { name: "Event text" })).toBeNull();
    // A chat keeps its message's field by its bubble
    expect(chatted.getByRole("img", { name: "Chat" })).toBeInTheDocument();
    expect(
      chatted.getByRole("textbox", { name: "Event text" }),
    ).toHaveAttribute("placeholder", "“tnt”");
    // Empty, an event without pictures shows its own text
    expect(
      anyGift.getByRole("textbox", { name: "Event text" }),
    ).toHaveAttribute("placeholder", "Any gift");
    expect(
      gifted.getByRole("button", { name: "Pick a picture" }),
    ).toBeInTheDocument();
    const change = followed.getByRole("button", { name: "Change the picture" });
    expect(change.querySelector("img")).toHaveAttribute(
      "src",
      "tokio-media:///games/minecraft/tnt.png",
    );
    expect(
      followed.getByRole("textbox", { name: "Name on the overlay" }),
    ).toHaveValue("TNT");
    // A disabled action never runs
    expect(recipeElements()[2]).toHaveClass(styles.recipe_off);
    expect(giftedRow).not.toHaveClass(styles.recipe_off);
  });

  it("saves the rows' edits", async () => {
    const { user } = await load([giftAction("a1"), chatAction("a2")]);
    await rose();
    const [gifted, chatted] = recipes();

    await user.type(
      chatted.getByRole("textbox", { name: "Event text" }),
      "Tap tap",
    );
    await user.type(
      gifted.getByRole("textbox", { name: "Name on the overlay" }),
      "TNT",
    );
    await user.click(
      chatted.getByRole("checkbox", { name: "Show on the overlay" }),
    );
    await wait(300);

    expect(savedOverlays()).toEqual([
      { show: true, image: null, event: "", name: "TNT", column: 1 },
      { show: false, image: null, event: "Tap tap", name: "", column: 1 },
    ]);
  });

  it("turns an event's gifts in one place, every 2 s, in the row and the preview", async () => {
    await load([
      giftAction("a1", {
        trigger: { ...trigger, type: TOKIO_EVENTS.GIFT, gifts: [5655, 6369] },
        overlay: { ...overlay, name: "TNT" },
      }),
    ]);
    const lion = gift(6369, "Lion");
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5655, "Rose"), lion],
    });
    const shown = (pictures: Element) =>
      [...pictures.querySelectorAll("img")]
        .filter(
          (img) =>
            !img.classList.contains(styles.recipe_away) &&
            !img.classList.contains("games-away"),
        )
        .map((img) => img.getAttribute("src"));
    const row = recipes()[0].getByRole("img", { name: "Rose or Lion" });
    const slots = previewRows()[0].querySelectorAll(".games-event .games-slot");
    expect(slots).toHaveLength(1);
    const [slot] = slots;

    const first = shown(row);
    expect(first).toHaveLength(1);
    expect(shown(slot)).toEqual(first);
    await wait(2000);

    const next = shown(row);
    expect(next).toHaveLength(1);
    expect(next).not.toEqual(first);
    expect(new Set([...first, ...next])).toEqual(
      new Set(["https://example.com/rose.png", lion.img]),
    );
    expect(shown(slot)).toEqual(next);
  });

  it("picks a picture from the Minecraft library", async () => {
    const { user } = await load([action("a1")]);

    await user.click(screen.getByRole("button", { name: "Pick a picture" }));
    const picker = screen.getByRole("dialog", { name: "Select picture" });
    expect(sent(APP_EVENTS.GET_MINECRAFT_PICTURES)).toHaveLength(1);
    await send(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
      success: true,
      data: [TNT, CREEPER],
    });
    await user.click(within(picker).getByRole("button", { name: "Creeper" }));
    await wait(300);

    expect(savedOverlays()[0].image).toEqual(CREEPER);
    // Marked, and still open
    expect(
      within(picker).getByRole("button", { current: true }),
    ).toHaveAccessibleName("Creeper");

    await user.click(within(picker).getByRole("button", { name: "Clear" }));
    await wait(300);
    expect(savedOverlays()[0].image).toBeNull();

    await user.click(within(picker).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts a browsed picture only on the action that asked, even after its picker closed", async () => {
    const { user } = await load([action("a1"), action("a2")]);

    await user.click(
      recipes()[0].getByRole("button", { name: "Pick a picture" }),
    );
    await user.click(screen.getByRole("button", { name: "Browse files..." }));
    expect(sent(APP_EVENTS.IMPORT_MINECRAFT_PICTURE)).toEqual([
      { id: "a1", request: 1 },
    ]);
    await user.click(screen.getByRole("button", { name: "Done" }));

    // Another action's, which didn't ask
    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id: "a2",
      request: 1,
      picture: CREEPER,
    });
    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id: "a1",
      request: 1,
      picture: TNT,
    });
    await wait(300);

    expect(savedOverlays().map((o) => o.image)).toEqual([TNT, null]);
    expect(
      recipes()[0].getByRole("button", { name: "Change the picture" }),
    ).toBeInTheDocument();
  });

  it("drops a browse once a picture is picked for the action", async () => {
    const { user } = await load([action("a1")]);

    await user.click(screen.getByRole("button", { name: "Pick a picture" }));
    await user.click(screen.getByRole("button", { name: "Browse files..." }));
    await send(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, {
      success: true,
      data: [CREEPER],
    });
    await user.click(screen.getByRole("button", { name: "Creeper" }));
    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id: "a1",
      request: 1,
      picture: TNT,
    });
    await wait(300);

    expect(savedOverlays()[0].image).toEqual(CREEPER);
  });

  it("keeps a newer browse when an older one answers late", async () => {
    const { user } = await load([action("a1")]);

    await user.click(screen.getByRole("button", { name: "Pick a picture" }));
    const browse = screen.getByRole("button", { name: "Browse files..." });
    await user.click(browse);
    await user.click(browse);
    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id: "a1",
      request: 2,
      picture: CREEPER,
    });
    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id: "a1",
      request: 1,
      picture: TNT,
    });
    await wait(300);

    expect(savedOverlays()[0].image).toEqual(CREEPER);
  });

  it("drops a browse made in another profile", async () => {
    const { user } = await load([action("a1")]);

    await user.click(screen.getByRole("button", { name: "Pick a picture" }));
    await user.click(screen.getByRole("button", { name: "Browse files..." }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    // A clone, whose action has the same id
    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.name = "Clone";
        p.games.actions = [action("a1")];
      }),
    );
    await send(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, {
      success: true,
      id: "a1",
      request: 1,
      picture: TNT,
    });
    await wait(300);

    expect(saves()).toEqual([]);
  });

  it("clears a deleted picture from the actions, so a save can't bring it back", async () => {
    await load([
      action("a1", { overlay: { ...overlay, image: TNT } }),
      action("a2", { overlay: { ...overlay, image: CREEPER } }),
    ]);

    await send(APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED, {
      file: TNT.file,
    });
    await wait(300);

    expect(savedOverlays().map((o) => o.image)).toEqual([null, CREEPER]);
    expect(
      recipes()[0].getByRole("button", { name: "Pick a picture" }),
    ).toBeInTheDocument();
  });

  it("says when the overlay server is off", async () => {
    setup();
    const notice =
      "The overlay server is off. Enable it in Settings to show this overlay on stream.";
    expect(sent(APP_EVENTS.GET_SETTINGS)).toHaveLength(1);

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = false;
      }),
    );
    expect(section("Overlay").getByText(notice)).toBeInTheDocument();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = true;
      }),
    );
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
  });

  it("saves the look, and shows it in the preview", async () => {
    const { user } = await load([
      action("a1", { overlay: { ...overlay, image: TNT } }),
    ]);

    await user.click(screen.getByRole("radio", { name: "One at a time" }));
    await user.click(screen.getByRole("checkbox", { name: "Pictures only" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Text below pictures" }),
    );
    await user.click(screen.getByRole("radio", { name: "Large" }));
    await user.type(screen.getByPlaceholderText("Archivo"), "Minecrafter");
    await wait(300);

    expect(saves().at(-1)!.overlay).toEqual({
      ...defaultProfile.games.overlay,
      layout: "carousel",
      pictures_only: true,
      text_below: true,
      event_size: "large",
      font: "Minecrafter",
    });
    const games = preview()!.parentElement!;
    expect(games).toHaveClass(
      "games",
      "games-carousel",
      "games-pictures-only",
      "games-text-below",
      "games-event-large",
    );
    expect(games.style.fontFamily).toBe(
      '"Minecrafter", "Archivo Variable", sans-serif',
    );
    expect(games.style.getPropertyValue("--games-accent")).toBe(
      defaultProfile.games.overlay.accent_color,
    );
  });

  it("puts the event's picture on the action's with Sticker, which has no arrow", async () => {
    const { user } = await load([
      action("a1", { overlay: { ...overlay, image: TNT } }),
      action("a2", { overlay: { ...overlay, name: "Zombie" } }),
    ]);
    const games = () => preview()!.parentElement!;
    const arrowColor = () => screen.queryByRole("group", { name: "Arrow" });
    expect(arrowColor()).toBeInTheDocument();
    expect(games().style.getPropertyValue("--games-arrow")).toBe(
      defaultProfile.games.overlay.arrow_color,
    );

    await user.click(screen.getByRole("radio", { name: "Sticker" }));
    await wait(300);

    expect(saves().at(-1)!.overlay.format).toBe("sticker");
    expect(games()).toHaveClass("games-sticker");
    // Without the action's picture, the event's takes its place
    expect(
      previewRows().map((li) => li.classList.contains("has-result-picture")),
    ).toEqual([true, false]);
    expect(arrowColor()).toBeNull();
  });

  it("previews the shown actions, named after their steps until named", async () => {
    const { user } = await load([
      giftAction("a1", { overlay: { ...overlay, image: TNT, name: "TNT" } }),
      chatAction("a2", { overlay: { ...overlay, name: "Creeper" } }),
      action("a3", { overlay: { ...overlay, show: false, name: "Hidden" } }),
      action("a4", { enabled: false, overlay: { ...overlay, name: "Off" } }),
      // Its zombie names it
      action("a5"),
      // A command makes nothing to name
      action("a6", { steps: [command("say hi")] }),
    ]);
    await rose();

    expect(previewTexts()).toEqual([
      ["Rose", "TNT"],
      ["“tnt”", "Creeper"],
      ["Follow", "Zombie"],
    ]);
    expect(
      recipes()[4].getByRole("textbox", { name: "Name on the overlay" }),
    ).toHaveAttribute("placeholder", "Zombie");
    expect(
      recipes()[5].getByRole("textbox", { name: "Name on the overlay" }),
    ).toHaveAttribute("placeholder", "No name");
    expect(
      [...previewRows()[0].querySelectorAll("img")].map((img) =>
        img.getAttribute("src"),
      ),
    ).toEqual([
      "https://example.com/rose.png",
      "tokio-media:///games/minecraft/tnt.png",
    ]);

    // The event's own text gives way to the one typed
    await user.type(
      recipes()[1].getByRole("textbox", { name: "Event text" }),
      "Tap tap",
    );
    expect(previewTexts()[1]).toEqual(["Tap tap", "Creeper"]);
  });

  it("hides a picture that doesn't load in the preview", async () => {
    await load([action("a1", { overlay: { ...overlay, image: TNT } })]);

    act(() => {
      previewRows()[0]
        .querySelector(".games-result img")!
        .dispatchEvent(new Event("error"));
    });

    expect(previewRows()[0].querySelector(".games-result img")).toBeNull();
    expect(previewRows()[0].querySelector(".games-result")).not.toHaveClass(
      "has-picture",
    );
  });

  it("waits for a row's gifts to turn before the next row, one at a time", async () => {
    const { user } = await load([
      giftAction("a1", {
        trigger: { ...trigger, type: TOKIO_EVENTS.GIFT, gifts: [5655, 6369] },
        overlay: { ...overlay, name: "TNT" },
      }),
      action("a2", { overlay: { ...overlay, name: "Zombie" } }),
    ]);
    const lion = gift(6369, "Lion");
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5655, "Rose"), lion],
    });
    await user.click(
      within(screen.getByRole("group", { name: "Layout" })).getByRole("radio", {
        name: "One at a time",
      }),
    );
    const current = () =>
      preview()!.querySelector(".games-current .games-name")?.textContent;
    const shownGift = () =>
      [...preview()!.querySelectorAll(".games-current .games-event img")]
        .filter((img) => !img.classList.contains("games-away"))
        .map((img) => img.getAttribute("src"));

    expect(current()).toBe("TNT");
    expect(shownGift()).toEqual(["https://example.com/rose.png"]);
    await wait(2000);
    expect(shownGift()).toEqual([lion.img]);
    // Past the 3 s a row with one gift gets
    await wait(1500);
    expect(current()).toBe("TNT");
    await wait(600);
    expect(current()).toBe("Zombie");
  });

  it("shows the count on the picture, in the row and the preview", async () => {
    await load([
      action("a1", {
        overlay: { ...overlay, image: TNT },
        steps: [{ type: "spawn", mob: "zombie", amount: 5, name: "" }],
      }),
    ]);

    const button = recipes()[0].getByRole("button", {
      name: "Change the picture",
    });
    expect(button).toHaveTextContent("5");
    // The picture says how many, so the name doesn't
    expect(
      recipes()[0].getByRole("textbox", { name: "Name on the overlay" }),
    ).toHaveAttribute("placeholder", "Zombie");
    expect(previewTexts()).toEqual([["Follow", "Zombie"]]);
    expect(
      previewRows()[0].querySelector(".games-slot-result .games-count"),
    ).toHaveTextContent("5");
  });

  it("keeps a small Minecraft picture drawn large sharp in the preview", async () => {
    await load([action("a1", { overlay: { ...overlay, image: TNT } })]);
    const img =
      previewRows()[0].querySelector<HTMLImageElement>(".games-result img")!;
    // jsdom loads no pictures and lays nothing out
    Object.defineProperty(img, "naturalWidth", { value: 16 });
    Object.defineProperty(img, "clientWidth", { value: 40 });

    act(() => {
      img.dispatchEvent(new Event("load"));
    });

    expect(img).toHaveClass("games-pixelated");
  });

  it("lights the next shown row with Test, cycling, for 1.5 s", async () => {
    const { user } = await load([
      action("a1", { overlay: { ...overlay, name: "TNT" } }),
      action("a2", { overlay: { ...overlay, show: false, name: "Hidden" } }),
      action("a3", { overlay: { ...overlay, name: "Creeper" } }),
    ]);

    await user.click(testButton());
    expect(litRows()).toEqual(["TNT"]);
    await user.click(testButton());
    await user.click(testButton());

    expect(sent(APP_EVENTS.TEST_GAMES_OVERLAY)).toEqual([
      { id: "a1" },
      { id: "a3" },
      { id: "a1" },
    ]);
    expect(litRows()).toEqual(["TNT", "Creeper"]);

    await wait(1500);
    expect(litRows()).toEqual([]);
  });

  it("turns one row at a time, and turns to the row Test lights", async () => {
    const { user } = await load([
      action("a1", { overlay: { ...overlay, name: "TNT" } }),
      action("a2", { overlay: { ...overlay, name: "Creeper" } }),
      action("a3", { overlay: { ...overlay, name: "Zombie" } }),
    ]);
    const current = () =>
      preview()!.querySelector(".games-current .games-name")?.textContent;
    await user.click(screen.getByRole("radio", { name: "One at a time" }));
    expect(current()).toBe("TNT");

    await wait(3000);
    expect(current()).toBe("Creeper");

    await user.click(testButton());
    expect(current()).toBe("TNT");
    // A whole turn from there
    await wait(2900);
    expect(current()).toBe("TNT");
    await wait(100);
    expect(current()).toBe("Creeper");
  });

  it("keeps the lit row it shows when Test lights another", async () => {
    const { user } = await load([
      action("a1", { overlay: { ...overlay, name: "TNT" } }),
      action("a2", { overlay: { ...overlay, name: "Creeper" } }),
    ]);
    const current = () =>
      preview()!.querySelector(".games-current .games-name")?.textContent;
    await user.click(screen.getByRole("radio", { name: "One at a time" }));

    await user.click(testButton());
    await user.click(testButton());

    expect(litRows()).toEqual(["TNT", "Creeper"]);
    expect(current()).toBe("TNT");
  });

  it("stays on the row one at a time shows when a row before it is hidden", async () => {
    const { user } = await load([
      action("a1", { overlay: { ...overlay, name: "TNT" } }),
      action("a2", { overlay: { ...overlay, name: "Creeper" } }),
      action("a3", { overlay: { ...overlay, name: "Zombie" } }),
    ]);
    const current = () =>
      preview()!.querySelector(".games-current .games-name")?.textContent;
    await user.click(screen.getByRole("radio", { name: "One at a time" }));
    await wait(3000);
    await wait(3000);
    expect(current()).toBe("Zombie");

    await user.click(
      recipes()[0].getByRole("checkbox", { name: "Show on the overlay" }),
    );

    expect(previewTexts()).toEqual([
      ["Follow", "Creeper"],
      ["Follow", "Zombie"],
    ]);
    expect(current()).toBe("Zombie");
  });
});
