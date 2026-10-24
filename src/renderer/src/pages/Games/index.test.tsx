import { GameAction, GameStep } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  GameStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import { failure, gift, profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList, section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Games } from ".";
import { createAction } from "./helper";

const action = (id: string, patch: Partial<GameAction> = {}): GameAction => ({
  ...createAction(),
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

  it("shows how to connect until the game connects", async () => {
    setup();
    await status({ state: "waiting" });
    await send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, {
      addresses: ["192.168.1.20"],
    });

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "In Settings → General → Network settings, turn on Enable WebSockets.",
      "Open a world with cheats on.",
      "Paste the command in the chat.",
    ]);
    const copies = screen.getAllByTitle("Copy the command");
    expect(copies.map((copy) => copy.textContent)).toEqual([
      "/connect 192.168.1.20:37892",
    ]);

    await status({ state: "connected" });
    expect(setupSteps()).not.toBeInTheDocument();
    expect(screen.queryByTitle("Copy the command")).not.toBeInTheDocument();
  });

  it("falls back to localhost when this PC has no network address", async () => {
    setup();
    await status({ state: "waiting" });
    expect(screen.queryByTitle("Copy the command")).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, { addresses: [] });

    expect(screen.getByTitle("Copy the command")).toHaveTextContent(
      "/connect localhost:37892",
    );
  });

  it("copies the command of each address", async () => {
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await status({ state: "waiting" });
    await send(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, {
      addresses: ["192.168.1.20", "10.0.0.5"],
    });
    const [first, second] = screen.getAllByTitle("Copy the command");

    await user.click(first);
    await user.click(second);

    expect(writeText.mock.calls).toEqual([
      ["/connect 192.168.1.20:37892"],
      ["/connect 10.0.0.5:37892"],
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
            trigger: expect.objectContaining({ type: TOKIO_EVENTS.FOLLOW }),
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
          ...createAction().trigger,
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

  it("tests an action and shows what the game answered", async () => {
    const steps = [command("say hi"), command("bad")];
    const { user } = await load([action("a1", { steps }), action("a2")]);
    const [first, second] = panels();

    await user.click(first.getByRole("button", { name: "Test" }));
    expect(sent(APP_EVENTS.TEST_GAME_ACTION)).toEqual([
      { id: "a1", trigger: TOKIO_EVENTS.FOLLOW, steps },
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
    expect(first.getByText("[Aku] hi")).toBeInTheDocument();
    expect(first.getByRole("img", { name: "Ran" })).toBeInTheDocument();
    expect(first.getByText("Syntax error")).toBeInTheDocument();
    expect(first.getByRole("img", { name: "Failed" })).toBeInTheDocument();
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
});
