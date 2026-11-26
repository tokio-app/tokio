---
paths:
  - "src/main/services/games/commands*"
  - "src/common/games/enchantments*"
---

# Minecraft commands

Builds on `.claude/rules/games.md`.

## Commands

- `gameCommands(step, fill, edition)` writes the edition's syntax. A mob or item id that isn't `/^[a-z0-9_]+$/` runs nothing.
- **Chicken Jockey** (`chicken_jockey`) is Tokio's own mob: `withJockey` adds it after Chicken in `MINECRAFT_NAMES`, so the picker, the overlay and `withEdition` know it. On Java it's a chicken with a baby zombie passenger, a name as the zombie's `CustomName`; the mod's tests check these forms.
- On Java the mod keeps every mob Tokio spawns, passengers included, from burning in daylight, and sets hostiles on the player after a 1-second grace (`GRACE_TICKS` in the mod's `Spawned`, the user's call): they spawn at the player's feet, and a crowd's first hits could kill at once. Tokio sends nothing for it. Bedrock has no grace: no command holds a mob back.
- The mod keeps what Tokio's commands make on the host alone (the user's call; the mod's `AGENTS.md`, "Only the host"): in a LAN world its mobs, blasts, lightning, fangs, projectiles, potions and dragon breath reach no other player, and only the host sees the meteors, lasers and a super laser's night (the world's clock stays), their particles following the host's **Particles** setting. On Bedrock they reach whoever is near.
- A Spawn mob step's mobs, and the Charged creeper's, come `SPAWN_GAP_MS` (250 ms) apart (`spaced`, the user's request): 100 take about 25 s, which holds the action's next run and Test. Lightning and evoker fangs still strike at once.
- **Bedrock** mobs (`bedrockMob`), checked against bedrock-samples' `mojang-commands.json` and `behavior_pack/entities`. What follows a summon targets `@e[type=<mob>,r=2,c=1]`, the one just summoned, before it moves:
  - A jockey summons a baby zombie, then `ride … summon_ride chicken no_ride_change minecraft:spawn_adult`. Summoning the rider leaves nearby chickens alone; `spawn_adult` because a baby chicken has no seat (`rideable` is in `chicken_adult`, for `baby_undead` only).
  - `DAYLIGHT_BURNERS` (mobs with `minecraft:burns_in_daylight`, minus the fire-immune magma cube; the jockey's zombie counts) get infinite hidden fire resistance.
  - `ANGER_EVENTS` are spawn events that set a neutral mob on the player, passed as summon's event (a name goes after it). Only the cave spider's `minecraft:become_angry` adds a player target: the zombie pigman's and enderman's anger has none until hit, the spider's `become_hostile` ends in daylight, piglins and brutes already attack. A spawn event replaces `minecraft:entity_spawned`, so it's no use where that sets the mob up (the zombie pigman's adult group).
- Variables are the trigger's `countedVariables` (`.claude/rules/triggers.md`), filled by `formatAlertMessage(text, payload, commandValue)`. `commandValue` strips `" ' \ { } [ ] § @ *` and control characters so a nickname can't inject NBT or selectors, nor name every score holder (`*`, which stripping alone makes of `[*]`); a spawn name goes through it whole, then `JSON.stringify`. The command step's template is the user's own and isn't escaped.
- `GameStepsSchema` drops saved creeper's hiss steps and makes the removed armor-set helps netherite, since a profile that fails to load can't be used and a rebuilt store replaces such a Default profile.

## Hazards and helps

Checked against Java 26.3's command tree, registries and decompiled commands (Vineflower: `FillCommand`, `SetBlockCommand`, `BlockPosArgument`, `TeleportCommand`, `ClearInventoryCommands`), and Bedrock's `mojang-commands.json` and `en_US.lang`. The Java forms run in the mod's `CommandRunnerTest`, each twice in a row.

- `GAME_HAZARDS` try to kill or prank the player. They carry no NBT but the creeper's and the fuse.
- The charged creeper is Bedrock's `minecraft:become_charged` spawn event and Java's `powered`. Evoker fangs are Bedrock's `evocation_fang`.
- Only `REPEATED_HAZARDS` (lightning, charged creeper, evoker fangs) repeat by the amount; the rest run once (the user's call for TNT). `COUNTED_HAZARDS`, those plus the meteor, show the amount in the editor and the overlay's name ("Meteor ×5").
- **The mod's own commands** (Java only, no slash, run as the host, their forms in the mod's `PROTOCOL.md`; `JAVA_ONLY_STEPS` and `JAVA_ONLY_HAZARDS`, nothing on Bedrock): the meteors (the mod drops them all around the player), the three lasers, **Turn into mob** (`morph`, `seconds` 1–600, or `null` until turned back, the default, the user's call) and **Back to normal** (`unmorph`).
- While a timed morph runs, the mod makes new ones wait their turn and an unmorph drops them; a death keeps the morph for the respawn, its time held while dead (the user's calls). A morphed host fires the mob's attack on the mod's key, R by default (the mod's `AGENTS.md`, "Attacks"); Tokio sends nothing for it.
- **Fuse** (seconds): Java's `fuse` in ticks. Bedrock's TNT takes none: it burns 4 s, or 0.5–2 s at random with its `from_explosion` event, used at 2 s or less. The page says so on Bedrock actions.
- **Anvil:** `setblock ~ ~20 ~ anvil keep`, since Bedrock can't summon a falling block. It never replaces a block, fails with no room, and stays in the world. Java 26.3 schedules a setblock'd anvil's fall unless the mode is `strict`.
- **Launch:** `launchPlan(height, seconds)` plays Java's physics (speed eases toward 0.05 × level by a fifth a tick, 2% drag, gravity 0.08 after the push) to find the weakest levitation level that gets there within `seconds`, up to `MAX_LEVEL` (amplifier 255, sent as a VarInt), and when to stop.
  - The stop is `teleport ~ ~ ~` after a `{ wait }`: it zeroes the climb's speed (`TeleportCommand` sends no `DELTA` relatives), so the fall starts at the top.
  - It's never before the push ends, which would lift the player again. Past the top level's reach (about 190 blocks in 1 s) the climb coasts and stops when it gets there. Bedrock's levitation may differ.
  - First `clearUp` sets to air the 3×3 column from 2 over the feet to `height + 2`, in fills of `SHAFT_ROWS` rows. Air fills drop nothing and take bedrock too, so under the Nether's roof the player goes through it: neither edition's `fill` filter can leave a block out.
  - A fill with a corner past the world's top fails whole, so only the pieces up there fail (2 failures each). Tokio doesn't know the player's height.
- **`sureFill`:** both editions refuse a fill that changes nothing (under open sky, over a trap already there). So each fill comes after `setblock <cell> structure_void` on a cell it writes; a keep fill, which writes only air, gets the cell set back to air first. The cell is on the farthest row, so a fill out of the world fails with its marker and leaves none.
- **Cobweb trap:** webs (Bedrock's `web`) into the air of the 3×3×3 around the player, their own cells included.
- **Honey trap** and **Obsidian prison:** a 5×5×5 `outline` around the 3×3 space, floor and roof included, the inside left alone, the shell replaced without drops. Honey can't fill the player's cells (they'd choke), so its floor slows them and stops jumps.
- **Lava lake:** a 2-wide ground ring around the player turns to lava and the block under them to obsidian. Filling the island too means a lake already there still changes.
- **Hole below:** air from the feet's row (slabs, carpets) down `depth` blocks, 3×3 so any player falls. Both are `execute unless block ~ ~-<depth> ~ bedrock run …`, so a hole reaching the world's floor digs nothing and never opens the void; one past the bottom fails whole. The End has no floor, so a deep hole there opens onto the void.
- **Clear inventory:** both editions refuse to clear an empty inventory, so a stick goes in the first hotbar slot before the `clear`.
- **Random boss:** one of `BOSSES` (Warden, Wither, Ravager, Evoker; Bedrock's `evocation_illager`) at the player. No Ender Dragon: a summoned one circles `0,0,0` and only chases players near it. An Elder Guardian can't move on land. On Java the host-only rule misses an Evoker's vexes (spawned after the command, untagged) and a Ravager's roar.
- **Waits and picks:** a `GameCommand` is a command, `{ wait: ms }`, `{ mayFail: command }` or `{ oneOf: commands }`. `_send` sends up to a wait, waits for the answers and the time, then the rest, so a launch holds its action's next run and Test. A wait has no result.
  - A batch repeats one run's commands `times`, so `_send` picks each `oneOf` as it sends: every run of a streak, and every Test, gets its own boss.
  - A `mayFail` the game fails counts as done (`ok: true`, the message kept): no notice, ✓ in Test. A `dropped` one still fails.
- `GAME_HELPS`: netherite armor, the Netherite kit, a full heal and effects. Every id is in both editions.
- **Netherite kit:** the armor's commands, then `NETHERITE_KIT`'s gives (64 arrows: Java's bow has Infinity, a plain Bedrock bow needs them). On Java it's always enchanted (the user's request).
- **Replacing yours** (`replace`, Give item and the kit): each give follows a `mayFail` `clear` of that item, taking all the player's own, so gifts don't fill the inventory; both editions fail a clear that finds none. On armor it takes the worn piece too, and the new one goes to the inventory.
- Armor goes on at once over what the player wears, which is lost (the user's call), with Java's `item replace` and Bedrock's `replaceitem`. Only replacing works: the mod counts an `execute if` that runs nothing as failed, and Bedrock can't tell an empty slot.
- **Enchanted** (Java only; Give item and the armor, off by default): `bestEnchantments(...items)` gives every non-curse enchantment the items take, at its top level, in `#tooltip_order`. Of exclusive ones, Protection, Depth Strider, Infinity (so no Mending on the bow), Multishot, Sharpness, Density, Fortune and Loyalty stay.
  - Checked against Java 26.3's `data/minecraft/enchantment`, `tags/item/enchantable` and `tags/enchantment/exclusive_set`: all 92 enchantable items. Items that take none, or only curses, give plain.
  - They go as the `enchantments` component, a map of levels since 1.21.5 (`[enchantments={sharpness:5,…}]`).
  - Bedrock can't: `give` and `replaceitem` take no enchantments and `enchant` works only on the held item. Its actions give plain items and keep the field for a switch back to Java.
