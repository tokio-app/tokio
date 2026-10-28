---
name: minecraft-lists
description: "Regenerate the Minecraft mob and item lists (src/common/games/minecraft-bedrock.json and minecraft-java.json) from Mojang's own data, and keep withEdition's PAIRS in step. Use after a Minecraft update, or when a mob or item is missing from the Games page's pickers."
argument-hint: "<bedrock|java> [version]"
---

# Regenerate the Minecraft lists

`src/common/games/minecraft-bedrock.json` and `minecraft-java.json` hold every mob and item each edition's `summon` and `give` take: `{ mobs, items }`, id → the game's English name, sorted by name. They feed `MINECRAFT_NAMES` (`src/common/util/games.ts`), and through it the Games page's pickers (`MOBS`, `ITEMS`) and the overlay's names. See `.claude/rules/games.md`. The names stay English in every app language: they're also how `withEdition` matches ids, and they aren't in the locale files.

## Bedrock

The current list is 1.26.50: 93 mobs, 1,596 items.

1. **Ids:** Mojang's `bedrock-samples` metadata: `metadata/vanilladata_modules/mojang-entities.json` and `mojang-items.json`, kept to the values of the `EntityType` and `Item` enums in `metadata/command_modules/mojang-commands.json` (what `summon` and `give` take).
2. **Left out:**
   - mobs: projectiles, boats and minecarts, the armor stand, `npc` and `cushion`;
   - items: command, structure, barrier, jigsaw and light blocks, and Education's `allow`, `deny` and `border_block`.
3. **Names:** the game's `en_US.lang`: `entity.<id>.name`, the item's `serialization_id`, `item.<id>.name` or `tile.<id>.name`, otherwise the id in title case. `tnt` is "Primed TNT".
4. **Check in the game:** run every id with `testfor @e[type=<id>]` and `clear @p <id> 0 0`, which count without changing the world. An unknown id is a syntax error. The 1.26.50 list had all 1,689 known.

## Java

The current list is 26.3: 95 mobs, 1,645 items. It comes from Mojang's own data, with JDK 25.

1. **Ids:** download the version's server jar (`downloads.server.url` in its version JSON) and run `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports --output generated` (in PowerShell, quote the `-D…` argument). Read `generated/reports/registries.json`: `minecraft:entity_type` and `minecraft:item`.
2. **Names:** `assets/minecraft/lang/en_us.json` from the client jar: `entity.minecraft.<id>`, and for items `item.minecraft.<id>.new`, `item.minecraft.<id>` or `block.minecraft.<id>`. So no two items share a name:
   - music discs are "Music Disc <song>", from `item.minecraft.<id>.desc`, the part after " - ", capitalized;
   - armor trims come from `trim_pattern.minecraft.<pattern>`;
   - upgrades come from `upgrade.minecraft.<id>`.
3. **Left out**, the same kinds as Bedrock's list:
   - mobs: player, projectiles, boats and rafts, minecarts, armor stand, displays, marker, interaction, `area_effect_cloud`, `item`, `falling_block`, `leash_knot`, painting, item frames, `evoker_fangs`, `ominous_item_spawner`, `cushion`, `mannequin`;
   - items: `air`, command blocks and their minecart, structure blocks and void, jigsaw, barrier, light, `debug_stick`, `test_block`, `test_instance_block`.
   - Kept: `tnt` ("Primed TNT"), `lightning_bolt`, `end_crystal`, `firework_rocket`, `experience_orb`.

## Ids that differ between editions

`withEdition` (`src/renderer/src/pages/Games/helper.ts`) moves an action's mobs and items to the other edition: the same id, else `PAIRS`, else the id with the same English name, else a zombie or a diamond.

- Most differing ids share a name and need nothing: Bedrock's `web` (Java's Cobweb), `evocation_illager` (Evoker) and `zombie_pigman` (Zombified Piglin) are mapped by name.
- `PAIRS` holds the ids that differ and whose names differ too (`ender_crystal`/`end_crystal`, the zombie pigman spawn egg, silver glazed terracotta, `undyed_shulker_box`/`shulker_box`).
- Add a pair when a regenerated list has an id that no name in the other list matches, but the same thing is there under another id.

## Done when

- Both JSON files hold `{ mobs, items }` sorted by name, and the version and counts above are updated.
- The help steps' ids (`helpCommands`, `src/main/services/games/commands.ts`) are still in both lists.
- `PAIRS` covers every new id that has a counterpart under another name.
- `yarn test src/renderer/src/pages/Games src/common/util/games.test.ts` passes, then `yarn typecheck` and `yarn lint`.
