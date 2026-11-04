// The highest level of each enchantment Tokio gives, in the order the game's
// tooltips list them (Java 26.3's data/minecraft/enchantment and its
// #tooltip_order tag)
const LEVELS = [
  ["channeling", 1],
  ["wind_burst", 3],
  ["lunge", 3],
  ["sharpness", 5],
  ["impaling", 5],
  ["power", 5],
  ["density", 5],
  ["sweeping_edge", 3],
  ["multishot", 1],
  ["fire_aspect", 2],
  ["flame", 1],
  ["knockback", 2],
  ["punch", 2],
  ["protection", 4],
  ["feather_falling", 4],
  ["fortune", 3],
  ["looting", 3],
  ["luck_of_the_sea", 3],
  ["efficiency", 5],
  ["quick_charge", 3],
  ["lure", 3],
  ["respiration", 3],
  ["aqua_affinity", 1],
  ["soul_speed", 3],
  ["swift_sneak", 3],
  ["depth_strider", 3],
  ["thorns", 3],
  ["loyalty", 3],
  ["unbreaking", 3],
  ["infinity", 1],
  ["mending", 1],
] as const;

export type Enchantment = (typeof LEVELS)[number][0];

const KEEP: Enchantment[] = ["unbreaking", "mending"];
const ARMOR: Enchantment[] = ["protection", "thorns", ...KEEP];
const MELEE: Enchantment[] = [
  "sharpness",
  "knockback",
  "fire_aspect",
  "looting",
  ...KEEP,
];
const TOOL: Enchantment[] = ["efficiency", "fortune", ...KEEP];

// Every enchantment each kind of item takes in Java 26.3, but the curses.
// Where two can't go together, the one here is Protection, Depth Strider,
// Infinity, Multishot, Sharpness, Density, Fortune or Loyalty.
const BEST: Record<string, Enchantment[]> = {
  helmet: [...ARMOR, "respiration", "aqua_affinity"],
  chestplate: ARMOR,
  leggings: [...ARMOR, "swift_sneak"],
  boots: [...ARMOR, "feather_falling", "depth_strider", "soul_speed"],
  sword: [...MELEE, "sweeping_edge"],
  spear: [...MELEE, "lunge"],
  axe: ["sharpness", ...TOOL],
  pickaxe: TOOL,
  shovel: TOOL,
  hoe: TOOL,
  shears: ["efficiency", ...KEEP],
  bow: ["power", "punch", "flame", "infinity", "unbreaking"],
  crossbow: ["multishot", "quick_charge", ...KEEP],
  trident: ["loyalty", "channeling", "impaling", ...KEEP],
  mace: ["density", "wind_burst", "fire_aspect", ...KEEP],
  fishing_rod: ["luck_of_the_sea", "lure", ...KEEP],
  shield: KEEP,
  elytra: KEEP,
  flint_and_steel: KEEP,
  brush: KEEP,
  carrot_on_a_stick: KEEP,
  warped_fungus_on_a_stick: KEEP,
};

// Tools, weapons and armor of every material go by their last word:
// diamond_sword is a sword
const TIERED =
  /_(helmet|chestplate|leggings|boots|sword|spear|axe|pickaxe|shovel|hoe)$/;

/**
 * The best enchantments Java items take between them, at their highest
 * level, in the order the game lists them. None for items that take none.
 */
export function bestEnchantments(
  ...items: string[]
): (readonly [Enchantment, number])[] {
  const best = items.flatMap((item) => {
    const kind = TIERED.exec(item)?.[1] ?? item;
    return Object.hasOwn(BEST, kind) ? BEST[kind] : [];
  });
  return LEVELS.filter(([id]) => best.includes(id));
}
