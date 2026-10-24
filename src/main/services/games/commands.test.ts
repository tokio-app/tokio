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

describe("gameCommands in Bedrock", () => {
  const run = (input: Record<string, unknown>, fill = none) =>
    gameCommands(step(input), fill, "bedrock");

  it("spawns where the player stands, named and repeated", () => {
    expect(run({ type: "spawn", mob: "zombie" })).toEqual([
      "summon zombie ~ ~ ~",
    ]);
    expect(
      run(
        { type: "spawn", mob: "chicken", amount: 2, name: "{username}" },
        () => 'Aku"} @e',
      ),
    ).toEqual(['summon chicken "Aku e" ~ ~ ~', 'summon chicken "Aku e" ~ ~ ~']);
  });

  it("escapes the whole name, not only its variables", () => {
    expect(run({ type: "spawn", mob: "pig", name: 'A "pig"' })).toEqual([
      'summon pig "A pig" ~ ~ ~',
    ]);
  });

  it("gives, sets the weather and the time", () => {
    expect(run({ type: "give", item: "diamond", amount: 5 })).toEqual([
      "give @p diamond 5",
    ]);
    expect(run({ type: "weather", weather: "thunder" })).toEqual([
      "weather thunder",
    ]);
    expect(run({ type: "time", time: "midnight" })).toEqual([
      "time set midnight",
    ]);
  });

  it("runs nothing for ids the game can't have", () => {
    expect(run({ type: "spawn", mob: "zombie ~ ~ ~ {}" })).toEqual([]);
    expect(run({ type: "give", item: "minecraft:diamond" })).toEqual([]);
  });

  it("fills a command, without its leading slash", () => {
    const fill = (text: string) => text.replace("{username}", "Aku");
    expect(
      run({ type: "command", command: " /say Hi {username}" }, fill),
    ).toEqual(["say Hi Aku"]);
    expect(run({ type: "command", command: "  " }, fill)).toEqual([]);
  });
});

describe("gameCommands in Java Edition", () => {
  const run = (input: Record<string, unknown>, fill = none) =>
    gameCommands(step(input), fill, "java");

  it("spawns where the player stands, named and repeated", () => {
    expect(run({ type: "spawn", mob: "zombie" })).toEqual([
      "summon minecraft:zombie ~ ~ ~",
    ]);
    expect(
      run(
        { type: "spawn", mob: "chicken", amount: 2, name: "{username}" },
        () => "Aku",
      ),
    ).toEqual([
      'summon minecraft:chicken ~ ~ ~ {CustomName:"Aku"}',
      'summon minecraft:chicken ~ ~ ~ {CustomName:"Aku"}',
    ]);
  });

  it("keeps a nickname inside the name's string", () => {
    expect(
      run(
        { type: "spawn", mob: "pig", name: "{username}" },
        () => String.raw`Aku"}, Passengers:[{id:"tnt"}] \"{`,
      ),
    ).toEqual([
      'summon minecraft:pig ~ ~ ~ {CustomName:"Aku, Passengers:id:tnt"}',
    ]);
  });

  it("gives to the player, sets the weather and the time", () => {
    expect(run({ type: "give", item: "diamond", amount: 5 })).toEqual([
      "give @s minecraft:diamond 5",
    ]);
    expect(run({ type: "weather", weather: "thunder" })).toEqual([
      "weather thunder",
    ]);
    expect(run({ type: "time", time: "midnight" })).toEqual([
      "time set midnight",
    ]);
  });

  it("runs nothing for ids the game can't have", () => {
    expect(run({ type: "spawn", mob: "zombie ~ ~ ~ {}" })).toEqual([]);
    expect(run({ type: "give", item: "minecraft:diamond" })).toEqual([]);
  });

  it("fills a command, without its leading slash", () => {
    const fill = (text: string) => text.replace("{username}", "Aku");
    expect(
      run({ type: "command", command: "/say Hi {username}" }, fill),
    ).toEqual(["say Hi Aku"]);
  });
});
