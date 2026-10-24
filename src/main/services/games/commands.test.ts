import { GameStep, GameStepSchema } from "@/common/schemas";
import { describe, expect, it } from "vitest";
import { commandValue, gameCommands } from "./commands";

const step = (input: Record<string, unknown>): GameStep =>
  GameStepSchema.parse(input);
const none = (text: string) => text;

describe("commandValue", () => {
  it("drops what could break out of a command", () => {
    expect(commandValue('Aku"} ,Passengers:[{id:"tnt"}]')).toBe(
      "Aku ,Passengers:id:tnt",
    );
    expect(commandValue("@e[type=player] 'x' \\ §cRed")).toBe(
      "etype=player x cRed",
    );
  });

  it("drops control characters and collapses whitespace", () => {
    expect(commandValue("  a\n\tb\u0000c\u007f   d  ")).toBe("a bc d");
  });

  it("caps the text at 100 characters", () => {
    expect(commandValue("x".repeat(150))).toHaveLength(100);
  });
});

describe("gameCommands", () => {
  it("spawns where the player stands, named and repeated", () => {
    expect(gameCommands(step({ type: "spawn", mob: "zombie" }), none)).toEqual([
      "summon zombie ~ ~ ~",
    ]);
    expect(
      gameCommands(
        step({ type: "spawn", mob: "chicken", amount: 2, name: "{username}" }),
        () => 'Aku"} @e',
      ),
    ).toEqual(['summon chicken "Aku e" ~ ~ ~', 'summon chicken "Aku e" ~ ~ ~']);
  });

  it("escapes the whole name, not only its variables", () => {
    expect(
      gameCommands(step({ type: "spawn", mob: "pig", name: 'A "pig"' }), none),
    ).toEqual(['summon pig "A pig" ~ ~ ~']);
  });

  it("gives, sets the weather and the time", () => {
    expect(
      gameCommands(step({ type: "give", item: "diamond", amount: 5 }), none),
    ).toEqual(["give @p diamond 5"]);
    expect(
      gameCommands(step({ type: "weather", weather: "thunder" }), none),
    ).toEqual(["weather thunder"]);
    expect(
      gameCommands(step({ type: "time", time: "midnight" }), none),
    ).toEqual(["time set midnight"]);
  });

  it("runs nothing for ids the game can't have", () => {
    expect(
      gameCommands(step({ type: "spawn", mob: "zombie ~ ~ ~ {}" }), none),
    ).toEqual([]);
    expect(
      gameCommands(step({ type: "give", item: "minecraft:diamond" }), none),
    ).toEqual([]);
  });

  it("fills a command, without its leading slash", () => {
    const fill = (text: string) => text.replace("{username}", "Aku");
    expect(
      gameCommands(
        step({ type: "command", command: " /say Hi {username}" }),
        fill,
      ),
    ).toEqual(["say Hi Aku"]);
    expect(
      gameCommands(step({ type: "command", command: "  " }), fill),
    ).toEqual([]);
  });
});
